# Apple Watch companion phase 0 spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the undocumented WorkoutKit, HealthKit, Keychain and network behaviours of section 16 on the owner's own iPhone and Apple Watch, and record go or no-go against each phase 0 stop criterion of section 13.

**Architecture:** A throwaway iOS app, `CompanionSpike`, whose one screen is a list of probe buttons. Each probe result is one JSON line in `Documents/probes.jsonl`, which the app shows and shares with `ShareLink` and `devicectl` pulls, so every finding cites log lines. Wire decoding and the `WorkoutPlan`-to-WorkoutKit mapper are built test-first on the Simulator; scheduling, HealthKit wakes, the tunnel and the Keychain are observed on the devices, and a Node sink on the Mac behind `tailscale serve` stands in for the server.

**Tech Stack:** Xcode 26.6 (17F113, iOS 26.5 SDK), Swift 6.3 compiler in Swift 5 language mode, SwiftUI, WorkoutKit, HealthKit, BackgroundTasks, URLSession, Security, Swift Testing, `xcodebuild`, `xcrun devicectl`, Node 24 with no packages, `tailscale serve` (Tailscale 1.104.2 on the Mac).

**Spec:** `docs/superpowers/specs/2026-11-09-apple-watch-companion-design.md` in the running log (sections 4, 7, 8, 10, 13, 14, 16). The design is on `main` since #701; the plan was written from that text.

## Global Constraints
- Paths are relative to the local git repository `~/src/companion-spike` (the owner confirms the location at review), which is never pushed, unless a path names the running log.
- Floor: "iOS 18 with watchOS 11" (D4). The deployment target is iOS 18.0; a device below it is recorded, not upgraded.
- "One iOS app in SwiftUI, with no watchOS target"; "no third-party package" (sections 4, 9).
- App target: "Swift 5 mode with strict concurrency set to targeted" (section 10); default actor isolation `nonisolated`.
- Tests: Swift Testing (`import Testing`) on `platform=iOS Simulator,name=iPhone 17,OS=26.5`. "The Simulator cannot run HealthKit background queries" (section 11), so background behaviour is observed on the devices.
- Mapper (section 7): `WorkoutPlan(.custom(workout), id: UUID(externalId))`; pace is "`SpeedRangeAlert` from 1000/slow to 1000/fast m/s, current speed"; the date is "`DateComponents(year:, month:, day:)` of the session date"; the cap is `WorkoutScheduler.maxAllowedScheduledWorkoutCount`, "never hard-coded".
- HealthKit reads "workouts, workout routes, heart rate and distance"; "It requests no write access" (sections 3, 9). For H6 alone the spike also reads step count and five running-form types (Task 5).
- Keychain: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, "no iCloud Keychain sync". Files are "excluded from backup and protected at `completeUntilFirstUserAuthentication`" (section 4).
- Transport: `Authorization: Bearer`, "never in a URL"; "The app refuses `http://` origins and redirects"; the Info.plist has no `NSAppTransportSecurity` key (sections 6, 9).
- Upload target: the throwaway sink `server/upload-sink.mjs` behind `tailscale serve`. Its Tailscale-issued certificate tests App Transport Security with no exception. Never the running log's ingest route.
- Probe log: one JSON line per result, holding codes, counts, sizes, times and synthetic ids only. Never a host, token, coordinate, heart-rate value, device name or `localizedDescription`.
- Public copy: "No host, tailnet, account or person is named" (design status line). Nothing from `spike.env`, `server/`, `logs/` or the Xcode project leaves this repository except Task 9's scanned text.
- Stop criteria (section 13), rows (a) to (e) of `FINDINGS.md`: "Stop if workouts do not reach the Watch, if `workoutPlan` linking and date matching both fail, if an overnight locked phone delivers nothing after its first unlock, if the route is missing at the first wake and never arrives, or if the shared node is not reachable from the app's `URLSession` with On Demand at its defaults."
- Device steps: every `./spike.sh install|launch|pull|uninstall` needs the iPhone connected by cable or Wi-Fi, unlocked and trusted, so the step is the owner's.
- Timebox: "5 to 8 days plus the enrolment wait" (section 13). Tasks 1-4 take days 1-2. Tasks 5-7 run on days 2-7 beside the owner's own runs, and Task 6 Steps 1-4 come before R1 so every run counts for H1 and H3. Days 2-7 need R1, R2 and R3 (Task 5), at least one more daytime outdoor run (four or more in all with the Task 6 build installed), two evening runs (the locked-night trials), one strap run if a strap exists, and one 10-minute workout for the force-quit probe, last. Task 8 is day 7 and Task 9 day 8.
- Item ids, one `FINDINGS.md` line each: WorkoutKit: W1 cap, W2 id reuse, W3 past items, W4 delete on the Watch, W5 `workoutPlan` set, W6 `supportsActivity`, W7 `supportsAlert`, W8 step and block limits, W9 date needs an hour, W10 time to the Watch, W11 newest-major changes, W12 open-step advance. HealthKit: H1 immediate or hourly, H2 locked night, H3 route and heart-rate delay, H4 force-quit, H5 heart-rate source, H6 cadence source, H7 free team and HealthKit, H8 scheduling needs a share type, H9 Health Auto Export id, H10 Info.plist keys and modes. Device and network: K1 Keychain after deletion, K2 watch models, N1 tunnel at background launch, N2 ATS with the certificate, N3 payload sizes.

## Review Focus
1. A HealthKit read the owner declined (routes or heart rate) returns no data and no error, so it reads as a route that "never arrives" (stop d). `requestStatus()` reads `unnecessary` after a denial too, so Task 6 Step 4 checks the grant on the Health app screen before any route or heart-rate conclusion.
2. An app swiped away, or reinstalled and not launched, or with Background App Refresh off or Low Power Mode on, gets no wake, which reads as a locked night that "delivers nothing" (stop c). Task 6 Step 8 counts a trial only after a logged launch and notes on all three.
3. A sleeping Mac, or a reset `tailscale serve`, makes the sink unreachable, which reads as a tunnel that was down (stop e). Task 7 Step 5 runs the sink under `caffeinate -s` on AC power with the lid open, and Task 7 Step 13 counts a failure only when sink heartbeats bracket it.
4. `schedule(_:at:)` neither throws nor returns, so a refused plan looks scheduled (stop a, W8, W9). Task 3 Step 1's `scheduleVerified` reads `scheduledWorkouts` back after every call and logs `present`.
5. Workouts left by an earlier probe outlive launches, so they inflate the cap count and mask id reuse. In Task 4 Step 5, W1 starts from `removeAllWorkouts()` and logs the real `countBefore`, and every later probe logs `countBefore` and removes only its own ids.

---

### Task 1: Devices, enrolment check and the empty app on the iPhone
**Files:**
- Create: `CompanionSpike.xcodeproj`, `CompanionSpike/CompanionSpike.entitlements` and `CompanionSpike/Info.plist` (all three by Xcode); `CompanionSpike/Probe/ProbeLog.swift`, `spike.sh`, `spike.env`, `.gitignore`, `FINDINGS.md`
- Modify: `CompanionSpike/CompanionSpikeApp.swift`, `CompanionSpike/ContentView.swift` (the probe screen of every task)
- Test: `CompanionSpikeTests/ProbeLogTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `spike.sh test|build|install|launch|pull|uninstall|expiry`, and:
```swift
final class ProbeLog: @unchecked Sendable {      // serial DispatchQueue inside; shared writes Documents/probes.jsonl
    static let shared: ProbeLog; var fileURL: URL { get }
    init(fileURL: URL, launchId: UUID = UUID(), now: @escaping @Sendable () -> Date = { Date() })
    func write(_ probe: String, _ event: String, _ data: [String: Any] = [:]); func lines() -> [String]
}
```

- [ ] **Step 1 (owner): Create the project.** In Xcode, File > New > Project > iOS App: Product Name `CompanionSpike`, Interface SwiftUI, Language Swift, Testing System Swift Testing, Storage None, the personal (free) team and your own reverse-DNS organisation identifier. Save in `~/src` with no Git repository, quit Xcode, then run `mv ~/src/CompanionSpike ~/src/companion-spike`.
- [ ] **Step 2 (owner): Configure the target.** Set Minimum Deployments to iOS 18.0. Add HealthKit with "Background Delivery" checked, and Background Modes with "Background fetch" and "Background processing". In Build Settings, set Swift Language Version Swift 5, Strict Concurrency Checking Targeted and Default Actor Isolation nonisolated. Delete any UI-test target and share the scheme `CompanionSpike`.
- [ ] **Step 3: Verify the settings.** `xcodebuild -project CompanionSpike.xcodeproj -target CompanionSpike -showBuildSettings | grep -E ' (IPHONEOS_DEPLOYMENT_TARGET|SWIFT_VERSION|SWIFT_STRICT_CONCURRENCY|SWIFT_DEFAULT_ACTOR_ISOLATION) = '` prints `18.0`, `5.0`, `targeted` and `nonisolated`. `plutil -p CompanionSpike/CompanionSpike.entitlements` shows `healthkit => true`, `healthkit.access => []` and `healthkit.background-delivery => true`. `plutil -p CompanionSpike/Info.plist` shows `UIBackgroundModes => [fetch, processing]`.
- [ ] **Step 4: Initialise the repository.** Run `git init`. `.gitignore` lists `build/`, `xcuserdata/`, `*.xcuserstate`, `.DS_Store`, `spike.env`, `server/.token` and `server/received.jsonl`. `spike.env` holds `DEVICE=` (the iPhone UDID from `xcrun devicectl list devices`), `BUNDLE_ID=`, `TEAM_ID=`, `IPHONE_NAME=`, `WATCH_NAME=` and `SPIKE_ORIGIN=` (Task 7); Task 9 scans for every one of these values.
- [ ] **Step 5: Write `spike.sh`.** It uses bash with `set -euo pipefail` and sources `spike.env`. Each subcommand runs exactly one command: `test`: `xcodebuild test -project CompanionSpike.xcodeproj -scheme CompanionSpike -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath build/sim -parallel-testing-enabled NO` (parallel clones keep test output off the console); `build`: `xcodebuild build -project CompanionSpike.xcodeproj -scheme CompanionSpike -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath build/device -allowProvisioningUpdates`; `install`: `xcrun devicectl device install app --device "$DEVICE" build/device/Build/Products/Debug-iphoneos/CompanionSpike.app`; `launch`: `xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID"`; `pull`: `xcrun devicectl device copy from --device "$DEVICE" --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" --source Documents/probes.jsonl --destination "logs/probes-$(date +%Y%m%d-%H%M).jsonl"`; `uninstall`: `xcrun devicectl device uninstall app --device "$DEVICE" "$BUNDLE_ID"`; `expiry`: `security cms -D -i build/device/Build/Products/Debug-iphoneos/CompanionSpike.app/embedded.mobileprovision | plutil -extract ExpirationDate raw -o - -`
- [ ] **Step 6: Write the failing test.**
```swift
@Test func writesOneSortedJSONLinePerCall() throws {
    let log = ProbeLog(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jsonl"), launchId: UUID(uuidString: "ABCDEF12-0000-4000-8000-000000000000")!, now: { Date(timeIntervalSince1970: 1_794_268_800) })
    log.write("APP", "launch"); log.write("W1", "cap", ["max": 15, "ok": true])
    #expect(log.lines().count == 2)
    #expect(log.lines()[1] == #"{"data":{"max":15,"ok":true},"event":"cap","launch":"abcdef12","probe":"W1","t":"2026-11-10T00:00:00.000Z"}"#)
    print("SELFTEST ok")
}
```

- [ ] **Step 7: Run the test.** `./spike.sh test` fails with `cannot find 'ProbeLog' in scope`.
- [ ] **Step 8: Implement `ProbeLog`.** Append `JSONSerialization` output (`[.sortedKeys, .withoutEscapingSlashes]`) and `\n`. `t` is ISO 8601 UTC with fractional seconds. `launch` is the first 8 hex characters of `launchId`, lowercased. `shared` also `print`s each line.
- [ ] **Step 9: Run the test again.** `./spike.sh test 2>&1 | grep -cE '^(SELFTEST ok|\*\* TEST SUCCEEDED \*\*)$'` prints `2`. If it prints `1`, test output does not reach the console: add `-resultBundlePath "build/sim-$(date +%Y%m%d-%H%M%S).xcresult"` to `spike.sh test`, and Task 4 Step 3 and Task 7 Step 3 take their lines from `xcrun xcresulttool get log --type console --path <newest bundle> | grep -oE '(SUPPORT|SIZE) [^"\\]+'` (that output is JSON).
- [ ] **Step 10: Build the screen.** `ContentView` is a `List` of probe sections (empty for now) and a "Log" section showing the last 200 lines newest first, with `ShareLink(item: ProbeLog.shared.fileURL)`. `CompanionSpikeApp.init` writes `("APP", "launch", ["os": UIDevice.current.systemVersion])`.
- [ ] **Step 11 (owner): Build for the device (H7).** Turn on Developer Mode, trust the Mac and keep the phone unlocked; `./spike.sh build` prints `** BUILD SUCCEEDED **`. If the free-team build fails naming the HealthKit or background-delivery entitlement, record the wording (without the team) in H7, remove the capability it names (Background Delivery alone, or HealthKit with it) and continue with Tasks 2 to 4 unchanged; Step 12 then prints less than 3. Enrol that day (US$99 a year; D2 recommends individual, the choice is the owner's), since Tasks 5 to 8 need it. After enrolment, switch the team, re-add the capability, and Steps 3, 11 and 12 must pass again. If the free-team build succeeds, phase 0 needs no enrolment.
- [ ] **Step 12: Check the signed entitlements.** `codesign -d --entitlements :- build/device/Build/Products/Debug-iphoneos/CompanionSpike.app | grep -c healthkit` prints `3`. Record H7.
- [ ] **Step 13 (owner): Install and launch.** On a free team, trust the developer under Settings > General > VPN & Device Management first. Run `./spike.sh install && ./spike.sh launch && ./spike.sh pull`; `grep -c '"event":"launch"' logs/probes-*.jsonl` prints 1 or more.
- [ ] **Step 14: Record the profile expiry.** `./spike.sh expiry` prints it; record it under Devices. On a free team, reinstall before that date: an expired app stops launching, and every background probe goes silent.
- [ ] **Step 15 (owner): Record the devices (K2).** Under Devices, with no device names, record the iPhone's product type, iOS version and build (from `xcrun devicectl device info details --device "$DEVICE"`), the Watch model and watchOS version (Watch app > General > About), Xcode 26.6 (17F113), and the Tailscale versions on the Mac (`tailscale version`) and the iPhone. Mark any device below iOS 18 or watchOS 11 (D4). Read Apple's "Apple Watch and iPhone compatibility" page (support.apple.com/en-us/118490) and record in K2, with the date, the Watch models watchOS 11 supports and those it drops. Ask each beta tester for iPhone model, iOS version, Watch model and watchOS version, and record counts per model and version, with no names.
- [ ] **Step 16: Check for WorkoutKit changes (W11).** `grep -n 'iOS 26\|iOS 18' "$(xcrun --sdk iphoneos --show-sdk-path)/System/Library/Frameworks/WorkoutKit.framework/Modules/WorkoutKit.swiftmodule/arm64e-apple-ios.swiftinterface"` prints three `@available(iOS 18.0, watchOS 11.0, *)` lines and no `iOS 26` (as of 2026-11-10). Then read the iOS 26 and watchOS 26 release notes (developer.apple.com/documentation/ios-ipados-release-notes and .../watchos-release-notes) for WorkoutKit and HealthKit, and record both in W11.
- [ ] **Step 17: Write the template and commit.** `FINDINGS.md` holds a Devices section, a `- **<id>** <name>: not yet run` line per item id, and a table `Criterion | Threshold | Observed | Go or no-go` with rows (a) to (e). Commit `chore: add the empty spike app, probe log and findings template`.

### Task 2: Fixture decoding and the mapper to `CustomWorkout`, test-first on the Simulator
**Files:**
- Create: `CompanionSpike/Resources/fixture-plan.json`, `CompanionSpike/Wire/WireModels.swift`, `CompanionSpike/Wire/WireDate.swift`, `CompanionSpike/Wire/Fixture.swift`, `CompanionSpike/Wire/WorkoutMapper.swift`
- Test: `CompanionSpikeTests/WireDecodingTests.swift`, `CompanionSpikeTests/WorkoutMapperTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
```swift
struct WirePlan: Codable, Equatable, Sendable { var wire: Int; var minWire: Int; var account: String; var today: String; var tz: String; var range: WireRange; var sessions: [WireSession] }
struct WireRange: Codable, Equatable, Sendable { var from: String; var to: String }
struct WireSession: Codable, Equatable, Sendable { var externalId: UUID; var date: String; var order: Int; var action: WireAction; var hash: String?; var workout: WireWorkout?; var cause: String? }
enum WireAction: String, Codable, Sendable { case send, withdraw }
struct WireWorkout: Codable, Equatable, Sendable { var title: String; var kind: String; var eased: Bool; var totalSec: Int; var rpe: [Double]; var description: String; var nodes: [WireNode] }
enum WireNode: Codable, Equatable, Sendable { case step(WireStep), repeatBlock(WireRepeat) }          // "type": "step" | "repeat"
struct WireStep: Codable, Equatable, Sendable { var intent: WireIntent; var label: String; var walk: Bool; var durationSec: Int; var target: WireTarget }
struct WireRepeat: Codable, Equatable, Sendable { var count: Int; var steps: [WireStep] }
enum WireIntent: String, Codable, Sendable { case warmup, work, recover, cooldown, steady }
enum WireTarget: Codable, Equatable, Sendable { case open, hrCeiling(floorBpm: Double, ceilingBpm: Double), hrBand(lowBpm: Double, highBpm: Double), pace(slowSecPerKm: Double, fastSecPerKm: Double) }  // "kind": "open" | "hr-ceiling" | "hr-band" | "pace"
enum WireDate { static func components(_ ymd: String) -> DateComponents?; static func adding(_ days: Int, to ymd: String) -> String?; static func string(from date: Date, timeZone: TimeZone) -> String }
extension WirePlan { func rebased(to today: String) -> WirePlan }          // shifts today, range and every date by the same days
enum Fixture { static func data() throws -> Data; static func plan() throws -> WirePlan }   // Bundle.main "fixture-plan.json"
struct WorkoutSupport: Sendable { var activity: @Sendable (HKWorkoutActivityType) -> Bool; var alert: @Sendable (any WorkoutAlert, HKWorkoutActivityType, HKWorkoutSessionLocationType) -> Bool; static let live: WorkoutSupport; static let all: WorkoutSupport }
struct MappedSession: Equatable, Sendable { var plan: WorkoutPlan; var date: DateComponents; var droppedAlerts: Int }
enum MapError: Error, Equatable { case withdrawn, unsupportedActivity(kind: String), badDate(String) }
enum WorkoutMapper { static func map(_ session: WireSession, support: WorkoutSupport) throws -> MappedSession; static func alert(for target: WireTarget) -> (any WorkoutAlert)? }
```

- [ ] **Step 1: Write `fixture-plan.json`.** Top level: `{"wire":1,"minWire":1,"account":"synthetic","today":"2026-11-10","tz":"UTC","range":{"from":"2026-11-10","to":"2026-11-23"},"sessions":[…]}`. A send session holds `externalId` `00000000-0000-4000-8000-0000000000NN`, `date` `2026-<date>`, `order` 0, `action` `"send"`, `hash` (the digit N repeated 64 times) and `workout`. The workout holds `title`, `kind`, `eased`, `totalSec`, `rpe`, `nodes` and `description` (equal to the title). A node is a step, `{"type":"step","intent","label","walk","durationSec","target"}`, or a repeat, `{"type":"repeat","count","steps"}`. In the table a step reads `<intent> <label> <durationSec> <target>`, with `walk` false unless marked.

| NN | date | kind | title | eased | rpe | totalSec | nodes |
|---|---|---|---|---|---|---|---|
| 01 | 11-10 | easy | Easy run, 45 min | false | [3,4] | 2700 | steady Run 2700 hr-band 124/142 |
| 02 | 11-11 | intervals | Intervals, 50 min | false | [6,7] | 3000 | warmup Warm up 600 open; repeat 6 [work Fast 192 pace 250/235; recover Recover 144 open]; cooldown Cool down 384 open |
| 03 | 11-12 | threshold | Threshold run, 40 min | false | [6,7] | 2400 | warmup Warm up 600 open; work Threshold 1200 pace 285/275; cooldown Cool down 600 open |
| 04 | 11-13 | long | Long run, 90 min | false | [3,4] | 5400 | steady Run 4440 hr-ceiling 40/148; repeat 4 [work Stride 20 open; recover Recover 70 open]; steady Run 600 open |
| 05 | 11-14 | hike | Hike, 75 min | false | [2,3] | 4500 | steady Hike 4500 hr-ceiling 40/135 |
| 06 | 11-15 | threshold | Cruise intervals, 55 min | false | [6,7] | 3300 | warmup Warm up 600 open; repeat 3 [work Cruise 480 pace 270/260; recover Easy 60 open]; work Cruise 480 pace 270/260; cooldown Cool down 600 open |
| 07 | 11-16 | easy | Run-walk, 25 min | true | [2,3] | 1500 | warmup Walk 300 open walk; repeat 6 [work Run 60 open; steady Walk 90 open walk]; cooldown Walk 300 open walk |
| 08 | 11-10 | | | | | | `"order":1,"action":"withdraw","cause":"rest-advice"`; no `hash`, no `workout` |

- [ ] **Step 2: Write the failing decoding and date tests** (`WireDecodingTests.swift`).
```swift
@Suite struct WireDecodingTests {
    func session(_ n: Int) throws -> WireSession { try Fixture.plan().sessions[n - 1] }
    @Test func decodesTheFixture() throws {
        let plan = try Fixture.plan()
        #expect(plan.today == "2026-11-10" && plan.range == WireRange(from: "2026-11-10", to: "2026-11-23"))
        #expect(plan.sessions.count == 8 && plan.sessions.filter { $0.action == .send }.count == 7 && plan.sessions[0].hash == String(repeating: "1", count: 64))
        #expect(try session(8).action == .withdraw && session(8).workout == nil && session(8).hash == nil && session(8).cause == "rest-advice")
        #expect(try session(4).workout?.nodes[0] == .step(WireStep(intent: .steady, label: "Run", walk: false, durationSec: 4440, target: .hrCeiling(floorBpm: 40, ceilingBpm: 148)))) }
    @Test func reencodesToEqualJSON() throws {
        let data = try Fixture.data(), again = try JSONEncoder().encode(JSONDecoder().decode(WirePlan.self, from: data))
        #expect(try JSONSerialization.jsonObject(with: data) as? NSDictionary == JSONSerialization.jsonObject(with: again) as? NSDictionary) }
    @Test func decodesAFractionalPaceAndRejectsAnUnknownKind() throws {
        #expect(try JSONDecoder().decode(WireTarget.self, from: Data(#"{"kind":"pace","slowSecPerKm":252.5,"fastSecPerKm":240}"#.utf8)) == .pace(slowSecPerKm: 252.5, fastSecPerKm: 240))
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(WireTarget.self, from: Data(#"{"kind":"power","watts":200}"#.utf8)) } }
    @Test func handlesDays() throws {
        let d = Date(timeIntervalSince1970: 1_794_268_799), p = try Fixture.plan().rebased(to: "2026-12-30")
        #expect(WireDate.components("2026-11-10") == DateComponents(year: 2026, month: 11, day: 10) && WireDate.components("2026-13-01") == nil && WireDate.components("10/11/2026") == nil)
        #expect(WireDate.adding(4, to: "2026-12-30") == "2027-01-03" && WireDate.adding(-1, to: "2026-03-01") == "2026-02-28")
        #expect(WireDate.string(from: d, timeZone: TimeZone(identifier: "UTC")!) == "2026-11-09" && WireDate.string(from: d, timeZone: TimeZone(identifier: "Asia/Tokyo")!) == "2026-11-10")
        #expect(p.today == "2026-12-30" && p.range.to == "2027-01-12" && p.sessions[4].date == "2027-01-03" && p.sessions[7].date == "2026-12-30") }
}
```

- [ ] **Step 3: Write the failing mapper tests** (`WorkoutMapperTests.swift`).
```swift
@Suite struct WorkoutMapperTests {
    func mapped(_ n: Int, _ s: WorkoutSupport = .all) throws -> MappedSession { try WorkoutMapper.map(Fixture.plan().sessions[n - 1], support: s) }
    func step(_ sec: Double, _ name: String, _ alert: (any WorkoutAlert)? = nil) -> WorkoutStep { WorkoutStep(goal: .time(sec, .seconds), alert: alert, displayName: name) }
    func work(_ s: WorkoutStep) -> IntervalStep { IntervalStep(.work, step: s) }
    func rest(_ s: WorkoutStep) -> IntervalStep { IntervalStep(.recovery, step: s) }
    func speed(_ slow: Double, _ fast: Double) -> SpeedRangeAlert { .speed((1000.0 / slow)...(1000.0 / fast), unit: .metersPerSecond, metric: .current) }
    func hr(_ r: ClosedRange<Double>) -> HeartRateRangeAlert { .heartRate(r) }
    func run(_ title: String, warmup: WorkoutStep? = nil, _ blocks: [IntervalBlock], cooldown: WorkoutStep? = nil) -> WorkoutPlan.Workout { .custom(CustomWorkout(activity: .running, location: .outdoor, displayName: title, warmup: warmup, blocks: blocks, cooldown: cooldown)) }
    @Test func easyRunIsOneBlockWithAHeartRateRange() throws {
        let m = try mapped(1)
        #expect(m.plan.id == UUID(uuidString: "00000000-0000-4000-8000-000000000001") && m.date == DateComponents(year: 2026, month: 11, day: 10) && m.droppedAlerts == 0)
        #expect(m.plan.workout == run("Easy run, 45 min", [IntervalBlock(steps: [work(step(2700, "Run", hr(124...142)))], iterations: 1)])) }
    @Test func intervalsTakeTheWarmUpTheRepeatAndTheCoolDown() throws {
        #expect(try mapped(2).plan.workout == run("Intervals, 50 min", warmup: step(600, "Warm up"), [IntervalBlock(steps: [work(step(192, "Fast", speed(250, 235))), rest(step(144, "Recover"))], iterations: 6)], cooldown: step(384, "Cool down"))) }
    @Test func longRunKeepsThreeBlocksInPlanOrder() throws {
        #expect(try mapped(4).plan.workout == run("Long run, 90 min", [IntervalBlock(steps: [work(step(4440, "Run", hr(40...148)))], iterations: 1), IntervalBlock(steps: [work(step(20, "Stride")), rest(step(70, "Recover"))], iterations: 4), IntervalBlock(steps: [work(step(600, "Run"))], iterations: 1)])) }
    @Test func cruiseIntervalsEndOnAOneStepBlock() throws {
        #expect(try mapped(6).plan.workout == run("Cruise intervals, 55 min", warmup: step(600, "Warm up"), [IntervalBlock(steps: [work(step(480, "Cruise", speed(270, 260))), rest(step(60, "Easy"))], iterations: 3), IntervalBlock(steps: [work(step(480, "Cruise", speed(270, 260)))], iterations: 1)], cooldown: step(600, "Cool down"))) }
    @Test func walkStepsAreRecoveryEvenWhenSteady() throws {
        #expect(try mapped(7).plan.workout == run("Run-walk, 25 min", warmup: step(300, "Walk"), [IntervalBlock(steps: [work(step(60, "Run")), rest(step(90, "Walk"))], iterations: 6)], cooldown: step(300, "Walk"))) }
    @Test func hikeIsHikingElseWalkingElseUnsupported() throws {
        #expect(try mapped(5).plan.workout.activity == .hiking && mapped(5, WorkoutSupport(activity: { $0 != .hiking }, alert: { _, _, _ in true })).plan.workout.activity == .walking)
        #expect(throws: MapError.unsupportedActivity(kind: "hike")) { try mapped(5, WorkoutSupport(activity: { _ in false }, alert: { _, _, _ in true })) } }
    @Test func anUnsupportedAlertIsDroppedAndCountedOncePerStep() throws {
        let m = try mapped(2, WorkoutSupport(activity: { _ in true }, alert: { a, _, _ in !(a is SpeedRangeAlert) }))
        guard case .custom(let w) = m.plan.workout else { Issue.record("not custom"); return }
        #expect(m.droppedAlerts == 1 && w.blocks[0].steps[0].step.alert == nil) }
    @Test func rangesNeverTrapAndAWithdrawalIsNotMapped() throws {
        #expect(WorkoutMapper.alert(for: .pace(slowSecPerKm: 250, fastSecPerKm: 250)) as? SpeedRangeAlert == .speed(4.0...4.0, unit: .metersPerSecond, metric: .current))
        #expect(WorkoutMapper.alert(for: .pace(slowSecPerKm: 235, fastSecPerKm: 250)) as? SpeedRangeAlert == speed(250, 235) && WorkoutMapper.alert(for: .hrBand(lowBpm: 150, highBpm: 140)) as? HeartRateRangeAlert == hr(140...150))
        #expect(WorkoutMapper.alert(for: .pace(slowSecPerKm: 0, fastSecPerKm: 250)) == nil)
        #expect(throws: MapError.withdrawn) { try mapped(8) } }
}
```

- [ ] **Step 4: Run the tests.** `./spike.sh test` fails with `cannot find 'Fixture' in scope`.
- [ ] **Step 5: Implement the wire models, `WireDate` and `Fixture`.** `WireStep` encodes and decodes its own `"type":"step"`, so a step round-trips in `nodes` and inside `steps`. `WireNode` switches on `type` and `WireTarget` on `kind`; an unknown value throws `DecodingError.dataCorrupted`. Nil optionals are omitted. `WireDate` uses a Gregorian calendar in UTC, and `components` accepts only `^\d{4}-\d{2}-\d{2}$` strings that round-trip through `Calendar.date(from:)`.
- [ ] **Step 6: Implement `WorkoutMapper.map` and `alert(for:)`** to pass the tests and section 7's table. Beyond them: an unparsable date throws `.badDate`; `alert(for:)` returns nil when any bound is 0 or below; an alert that `support.alert(alert, activity, .outdoor)` refuses becomes nil and adds 1 to `droppedAlerts` per step. `.live` calls `CustomWorkout.supportsActivity` and `supportsAlert`; `.all` answers true.
- [ ] **Step 7: Run the tests and commit.** `./spike.sh test` prints `** TEST SUCCEEDED **`. Commit `feat: decode the fixture plan and map it to WorkoutKit`.

### Task 3: One hard-coded workout onto the Watch (stop criterion a)
**Files:**
- Create: `CompanionSpike/Probe/SchedulerProbe.swift`, `CompanionSpike/Probe/Ledger.swift`
- Modify: `CompanionSpike/ContentView.swift` (a "Schedule" section)

**Interfaces:**
- Consumes: `ProbeLog.shared.write`, `WireDate`, `Fixture.plan()`, `WirePlan.rebased(to:)`, `WorkoutMapper.map(_:support:)`, `WorkoutSupport.live`.
- Produces:
```swift
struct LedgerEntry: Codable, Equatable, Sendable { var date: String; var name: String }
enum Ledger { static func record(_ id: UUID, date: String, name: String); static func all() -> [UUID: LedgerEntry] }  // Application Support/scheduled.json
enum SchedulerProbe {
    static func authorize() async -> WorkoutScheduler.AuthorizationState; static func today() -> String   // WireDate.string(from: Date(), timeZone: .current)
    static func scheduleVerified(_ plan: WorkoutPlan, date: String, name: String, probe: String) async -> Bool
    static func hardCoded() -> WorkoutPlan; static func scheduleFixture() async; static func readSchedule(probe: String) async -> [ScheduledWorkoutPlan]
}
```

- [ ] **Step 1: Implement `SchedulerProbe` and `Ledger`.** `authorize` logs `WK auth {before, after, isSupported}` with the state names. `scheduleVerified` calls `schedule(plan, at: WireDate.components(date)!)`, reads `scheduledWorkouts` back and logs one `<probe> schedule` line `{id8, date, name, countBefore, present, countAfter, ms}`. When the plan is present, it records a `Ledger` entry; the ledger file is protected at `completeUntilFirstUserAuthentication` and excluded from backup. `hardCoded()` has id `00000000-0000-4000-8000-0000000000a1` and is `CustomWorkout(activity: .running, location: .outdoor, displayName: "Spike hard-coded 20 min", blocks: [IntervalBlock(steps: [IntervalStep(.work, goal: .time(20, .minutes))], iterations: 1)])`. `scheduleFixture` rebases the fixture to `today()`, maps each session with `.live` (logging `FX map {n, ok, dropped, error}`), schedules each send through `scheduleVerified`, and logs the withdrawal, unmapped, as `FX withdraw {n: 8}`. `readSchedule` logs `{id8, name, y, m, d, hour, complete}` per entry.
- [ ] **Step 2 (owner): Add the buttons and install.** Add Authorize WorkoutKit, Schedule hard-coded, Schedule fixture and Read schedule. `./spike.sh test` prints `** TEST SUCCEEDED **`; then run `./spike.sh build && ./spike.sh install && ./spike.sh launch`.
- [ ] **Step 3 (owner): Authorise WorkoutKit.** Tap Authorize WorkoutKit and allow; the log shows `"event":"auth"` with `"after":"authorized"`.
- [ ] **Step 4 (owner): Schedule the hard-coded workout.** With the Watch on the wrist and unlocked, and Bluetooth and Wi-Fi on, tap Schedule hard-coded; the log shows `"present":true`. In the Workout app on the Watch, record whether the companion section shows "Spike hard-coded 20 min", and how many minutes it took. If it is not there within 10 minutes, retry twice, once on another day.
- [ ] **Step 5 (owner): Schedule the fixture.** Tap Schedule fixture: the log shows 7 `FX map` lines with `ok: true` and 7 with `present: true`. "View More" on the Watch lists the seven sessions from today to today+6. Open the previews of 01, 02, 05 and 07, and record under W6/W7 the step names, the heart-rate range 124-142, the pace 4:10-3:55 /km, and whether 05 shows as Hiking or Walking.
- [ ] **Step 6 (owner): Record H8 and row (a), then commit.** H8: if Step 4 passed, scheduling needed no HealthKit authorisation; Task 5 makes the first HealthKit request. Row (a) is go if Step 4 logged `present: true` and the Watch showed the workout within 10 minutes. It is no-go if three tries over two days fail. Run `./spike.sh pull` and commit `test: record the first workout on the Watch`.

### Task 4: The WorkoutKit limit probes
**Files:**
- Create: `CompanionSpike/Probe/LimitProbes.swift`, `CompanionSpike/Probe/SupportMatrix.swift`
- Modify: `CompanionSpike/ContentView.swift` (a "Limits" section with the buttons Support matrix, Cap, Id reuse, Limits, Date, Past, "Marker: Delete me" (today+2, probe W4), "Marker: Sync" (today, named Sync 1 to Sync 3 by a count the view keeps, probe W10), "Marker: Alerts" (`alertProbe`, today, probe W7), "Marker: Open step" (`openStepProbe`, today, probe W12) and "Seen on Watch")
- Test: `CompanionSpikeTests/SupportMatrixTests.swift`

**Interfaces:**
- Consumes: `SchedulerProbe.scheduleVerified`, `SchedulerProbe.readSchedule`, `SchedulerProbe.today()`, `WireDate.adding`, `ProbeLog`.
- Produces:
```swift
enum SupportMatrix { struct Row: Equatable, Sendable { var check: String; var item: String; var activity: String; var location: String; var supported: Bool }; static func rows() -> [Row]; static func logRows() }   // logRows: one SUPPORT row line per row
enum LimitProbes {
    static func cap() async; static func idReuse() async; static func past() async; static func limits() async; static func date() async
    static func marker(_ name: String, _ workout: CustomWorkout, daysFromToday: Int, probe: String) async   // fresh UUID; remembers the time for seenOnWatch
    static func seenOnWatch(); static func minimal(_ name: String) -> CustomWorkout   // seenOnWatch logs W10 seconds; minimal: one 600 s .work step, running, outdoor
    static let alertProbe: CustomWorkout; static let openStepProbe: CustomWorkout
}
```

- [ ] **Step 1: Write the failing test.**
```swift
@Test func supportMatrixHasThirtyThreeDistinctRows() {
    let rows = SupportMatrix.rows()
    #expect(rows.count == 33 && Set(rows.map { "\($0.check)|\($0.item)|\($0.activity)|\($0.location)" }).count == 33)
    rows.forEach { print("SUPPORT \($0.check) \($0.item) \($0.activity) \($0.location) \($0.supported)") }
}
```

- [ ] **Step 2: Implement `rows()`.** It has 33 rows, with `supported` read from `CustomWorkout.supports*`: three `activity` rows (running, hiking, walking), with location `-`; for each of those activities, at outdoor and at indoor: `alert` rows: `hr-range` (`.heartRate(120...150)`) and `speed-range` (`.speed(3.0...3.5, unit: .metersPerSecond, metric: .current)`); `goal` rows: `time` (`.time(600, .seconds)`), `distance` (`.distance(1, .kilometers)`) and `open`. `logRows()` writes `("SUPPORT", "row", {check, item, activity, location, supported})` per row.
- [ ] **Step 3: Record the Simulator answers.** `./spike.sh test 2>&1 | grep '^SUPPORT' | tee logs/support-simulator.txt | wc -l` prints `33`. Record these as the Simulator answers in W6 and W7.
- [ ] **Step 4: Implement the two probe workouts.** Both are running, outdoor. `alertProbe` ("Alert probe"): a warm-up of `.time(60, .seconds)`, then one block of two `.work` steps of `.time(120, .seconds)`: "Speed alert" with `.speed(4.0...4.5, unit: .metersPerSecond, metric: .current)` and "HR alert" with `.heartRate(40...60)`. `openStepProbe` ("Open step probe"): warm-up `.open` "Open warm-up", one block of one `.work` step `.time(60, .seconds)` "Timed", and cool-down `.open` "Open cool-down".
- [ ] **Step 5: Implement the probes, each scheduling through `scheduleVerified`.** `cap` calls `removeAllWorkouts()` and logs `max` and the real `scheduledWorkouts.count` as `countBefore`; if that is not 0, W1 records it and counts the cap as the `Cap` items present (`countAfter − countBefore`). It schedules `max + 2` `minimal("Cap <i>")` one per day from today+1 (`spread`), logging `{variant, i, countAfter}`, then logs the first and last three kept id8s. Then `removeAllWorkouts()`, the same with all of them on today+1 (`same-day`), and `removeAllWorkouts()` again. Every other probe logs `countBefore` and removes only its own ids. `idReuse` uses id `00000000-0000-4000-8000-0000000000b2` at today+2. It schedules "Reuse v1" (600 s), removes it, schedules "Reuse v2" (720 s), then "Reuse v3" (840 s) with no remove, logging `{entriesWithId, names}` after each. `limits` runs n in [10, 50, 100, 250] at today+3 over three shapes: `blocks` (n blocks of one 60 s step), `steps` (one block of n 30 s steps, alternating work and recovery) and `iterations` (one block of two 30 s steps × n). For each it logs `{shape, n, encodes: (try? plan.dataRepresentation) != nil, present}`, then removes all but the largest present plan per shape. `date` schedules "Date A" at `DateComponents(year:month:day:)` of today+1, and "Date B" with `hour: 7, minute: 0` added. It logs each read-back date as `{y, m, d, hour, minute, calendar, timeZone}`. `past` schedules "Past yesterday" at today-1 and "Past today" at today.
- [ ] **Step 6 (owner): Install.** `./spike.sh test` prints `** TEST SUCCEEDED **`; then run `./spike.sh build && ./spike.sh install && ./spike.sh launch`.
- [ ] **Step 7 (owner): Run the probes on day 1, in this order, pulling after each.** Support matrix: `grep -c '"probe":"SUPPORT"'` on the pulled log prints `33` (W6, W7). Cap (W1): `max`, and whether the extra workouts at `max + 1` and `max + 2` were refused, evicted (and which ids stayed) or accepted. Id reuse (W2): `entriesWithId` after v2 and v3, and the name the Watch shows for today+2. Limits (W8): the largest n per shape that encodes and is present. Open each kept plan on the Watch and record whether it renders and starts. Date (W9): whether both are present, the read-back hour, and whether both are listed on the Watch for today+1.
- [ ] **Step 8 (owner): Deletion on the Watch (W4).** Tap Marker: Delete me (`marker("Delete me", minimal("Delete me"), daysFromToday: 2, probe: "W4")`). Try to delete it on the Watch (Workout app, the companion section, the ••• list) and in the iPhone's Fitness app; record the gesture or "no delete option". Then tap Read schedule and record whether it is still listed.
- [ ] **Step 9 (owner): Time to the Watch (W10).** Run three trials with Marker: Sync: (1) the Workout app open on the wrist, tapping Seen on Watch when it appears; (2) the Workout app closed, then opened after 60 s, tapping Seen on Watch; (3) the phone locked straight after scheduling, noting `date -u +%H:%M:%S` on the Mac when it appears (unlocking to tap would itself prompt delivery). Record the seconds for each; trial (3)'s is the noted time minus the `t` of its `W10 schedule` line.
- [ ] **Step 10 (owner): Alerts on the Watch (W7).** Tap Marker: Alerts, start it outdoors and walk 5 minutes; walking is below 4.0 m/s and above 60 bpm. Record whether "Speed alert" and "HR alert" each fired, how (haptic, screen text) and whether step names showed. Repeat once choosing Indoor at the start.
- [ ] **Step 11 (owner): Open steps (W12).** Tap Marker: Open step and start it. Record which input moves "Open warm-up" on to "Timed" (tap, swipe, side button or double tap), and what ends "Open cool-down".
- [ ] **Step 12 (owner): Past items (W3).** As the last probe on day 1, tap Past. On day 2, before anything else, tap Read schedule. Record whether "Past yesterday" was accepted and whether "Past today" is still listed in the app and in the Watch's View More.
- [ ] **Step 13: Commit.** `test: record the WorkoutKit limit probes`.

### Task 5: A real run of a scheduled workout and the link back (stop criterion b)
**Files:**
- Create: `CompanionSpike/Probe/HealthProbe.swift`
- Modify: `CompanionSpike/Info.plist`, `CompanionSpike/ContentView.swift` (a "Health" section: Authorize Health, Health status, Link run today, Link run tomorrow, Read workouts)

**Interfaces:**
- Consumes: `Ledger.all()`, `LimitProbes.marker`, `SchedulerProbe.readSchedule`, `WireDate.string(from:timeZone:)`.
- Produces:
```swift
enum HealthProbe {
    static let store: HKHealthStore; static let readTypes: Set<HKObjectType>   // workoutType(), HKSeriesType.workoutRoute(), HKQuantityType of .heartRate, .distanceWalkingRunning, and for H6 .stepCount, .runningPower, .runningSpeed, .runningStrideLength, .runningGroundContactTime, .runningVerticalOscillation
    static let linkRun: CustomWorkout                 // running, outdoor, one block of one .work step with goal .open
    static func authorize() async; static func requestStatus() async -> String       // "shouldRequest" | "unnecessary" | "unknown"
    static func recentWorkouts(days: Int) async throws -> [HKWorkout]   // running, hiking, walking; newest first
    static func linkReport(_ workout: HKWorkout) async -> [String: Any]  // {w8, activity, startDay, planId8 or "nil", ledgerName, scheduledDay, dayDelta, indoor}
}
```

- [ ] **Step 1: Add the Health usage text.** `plutil -insert NSHealthShareUsageDescription -string "Reads workouts, routes, heart rate, distance, steps and running form to test the running log companion." CompanionSpike/Info.plist`; then `plutil -extract NSHealthShareUsageDescription raw CompanionSpike/Info.plist` prints that string.
- [ ] **Step 2: Implement `HealthProbe` and the buttons.** `authorize` logs `HK auth {before, after}` from `requestStatus()`, around `requestAuthorization(toShare: [], read: readTypes)`. `recentWorkouts` uses `HKSampleQueryDescriptor`. `linkReport` reads `try await workout.workoutPlan` and looks its `id` up in `Ledger.all()`. `startDay` uses `TimeZone.current`, and `dayDelta` is startDay minus scheduledDay. HealthKit errors are logged as `{domain, code}` only. Link run today and Link run tomorrow call `marker("Spike run <date>", linkRun, daysFromToday: 0 or 1, probe: "W5")`.
- [ ] **Step 3 (owner): Install.** `./spike.sh test` prints `** TEST SUCCEEDED **`; then run `./spike.sh build && ./spike.sh install && ./spike.sh launch`.
- [ ] **Step 4 (owner): Authorise Health.** Tap Authorize Health and turn on every listed type; the log shows `HK auth` with `"after":"unnecessary"`, which says only that the sheet was answered (the grant check is Task 6 Step 4).
- [ ] **Step 5 (owner): R1, on day A, after Task 6 Step 4.** Tap Link run today, start "Spike run <A>" from the companion section of the Workout app, and run as usual.
- [ ] **Step 6 (owner): R2, on day B.** Tap Link run tomorrow, then start that workout today from View More and run.
- [ ] **Step 7 (owner): R3.** Any Outdoor Run started by hand during the spike.
- [ ] **Step 8 (owner): Read the links (W5).** Tap Read workouts after each run and record the observed values. The `W5` lines are expected to show: R1: `planId8` equal to the ledger id8 of "Spike run <A>", and `dayDelta: 0`; R2: `planId8` equal to the day-B+1 id8, and `dayDelta: -1`; R3: `planId8: "nil"`.
- [ ] **Step 9 (owner): Completion (W3).** The day after R1, tap Read schedule; record `complete` for "Spike run <A>" and whether it is still listed.
- [ ] **Step 10 (owner): Record row (b) and commit.** Date matching (kind and date within `MATCH_SPREAD_DAYS = 1`, section 8) holds for R1 only if its `W5` line shows `activity` running and `startDay` equal to the date of its `W5 schedule` line, in the phone's zone. Row (b) is go if R1 or R2 carries its matching `planId`, or date matching holds for R1; it is no-go otherwise. Pull and commit `test: record the workoutPlan link and date matching`.

### Task 6: HealthKit background reads (stop criteria c and d)
**Files:**
- Create: `CompanionSpike/AppDelegate.swift`, `CompanionSpike/Probe/BackgroundProbe.swift`
- Modify: `CompanionSpike/CompanionSpikeApp.swift`: `@UIApplicationDelegateAdaptor(AppDelegate.self)`; when `scenePhase` becomes `.active`, `HealthProbe.catchUp(trigger: "foreground")`. `CompanionSpike/Probe/HealthProbe.swift`, `CompanionSpike/Info.plist`.

**Interfaces:**
- Consumes: `HealthProbe.store`, `HealthProbe.readTypes`, `HealthProbe.requestStatus()`, `ProbeLog`.
- Produces:
```swift
final class AppDelegate: NSObject, UIApplicationDelegate { func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool }
extension HealthProbe {   // startObservers runs before didFinishLaunching returns; catchUp is serialised, each run awaiting the previous run's Task
    static func startObservers(); static func catchUp(trigger: String) async; static func firstLaunchDate() -> Date   // Application Support/first-launch.json, written at the first call
    static func recheckPending(trigger: String) async; static func sourceReport(_ workout: HKWorkout) async -> [String: Any]
}
enum BackgroundProbe { static var refreshId: String { get }; static var processingId: String { get }; static func register(); static func submit() }  // bundle id + ".refresh" / ".processing"
```

- [ ] **Step 1: Permit the task ids.** Run `plutil -insert BGTaskSchedulerPermittedIdentifiers -json '["$(PRODUCT_BUNDLE_IDENTIFIER).refresh","$(PRODUCT_BUNDLE_IDENTIFIER).processing"]' CompanionSpike/Info.plist`. After the next build, `plutil -extract BGTaskSchedulerPermittedIdentifiers json -o - build/device/Build/Products/Debug-iphoneos/CompanionSpike.app/Info.plist` prints both ids with the real bundle id.
- [ ] **Step 2: Implement the background reads with these rules.** **Launch.** `didFinishLaunching` logs `APP launch {options: launch option keys, protected: application.isProtectedDataAvailable, state}`, then calls `firstLaunchDate()`, `startObservers()`, `BackgroundProbe.register()` and `BackgroundProbe.submit()`. **Protected data.** On `protectedDataDidBecomeAvailableNotification` the app logs `APP protected-available` and runs `catchUp("protected")`; `protectedDataWillBecomeUnavailableNotification` is logged only. Read the state from `UIApplication.shared.isProtectedDataAvailable`: the iOS 26.5 SDK declares no `HKHealthStore.isProtectedDataAvailable()`, though section 4 names one. **Observers.** `startObservers` creates one `HKObserverQuery` on `.workoutType()` and one on `HKSeriesType.workoutRoute()`, and calls `enableBackgroundDelivery(for:frequency: .immediate)` for each, logging `H1 enable {type, ok, code}`. Each update handler logs `H1 wake {type, protected}`, awaits `catchUp("observer-<type>")`, then calls its completion handler. On an error it logs `{domain, code}` and still calls the handler. **`catchUp`.** When protected data is unavailable, it logs `H2 skip {trigger}` and returns. Otherwise it runs `HKAnchoredObjectQueryDescriptor` per type with the predicate `HKQuery.predicateForSamples(withStart: firstLaunchDate(), end: nil, options: [])`, with the anchors archived in `Application Support/anchor-<type>.bin`; a workout that ended before `firstLaunchDate()` is never read, queued or uploaded, and Upload latest run (Task 7 Step 11) is the only way to send one. Each new workout logs `H1 read {trigger, w8, endAgoSec, indoor, route, routePoints, hr}` and `sourceReport`. A new workout joins `Application Support/pending.json` when it is outdoor without a route, or has no heart-rate samples. Then `catchUp` calls `recheckPending`. Error `code 6` is `errorDatabaseInaccessible`. **`recheckPending`.** Logs `H3 arrive {what: "route"|"hr", w8, endAgoSec, trigger}` the first time each item appears, and drops a workout when it is complete or 24 h after its end (`H3 release`). **`sourceReport`.** Logs `H5 {workoutDevice, hrDevices, hrProducts}` (distinct HKDevice `model`/`manufacturer`/`hardwareVersion`, never `name`, plus `sourceRevision.productType`) and `H6 {statistics: workout.allStatistics identifiers, metadataKeys: workout.metadata keys}` (keys only, never values). **Background tasks.** Each task handler logs `BG run {id}`, awaits `catchUp("bg-refresh"|"bg-processing")`, resubmits, and calls `setTaskCompleted(success: true)`; the expiration handler logs `BG expired`. `submit` sends a refresh request (`earliestBeginDate` now+900 s), a processing request (`requiresNetworkConnectivity` and `requiresExternalPower` true) and a refresh request for bundle id + `.notlisted`, logging `H10 submit {id, ok, code}` for each.
- [ ] **Step 3 (owner): Install and record H10.** `./spike.sh build && ./spike.sh install && ./spike.sh launch && ./spike.sh pull`. The log shows no `H1 read` line (nothing has ended since `firstLaunchDate()`), two `H1 enable` lines with `ok: true`, and `H10 submit` lines: refresh `ok: true`, processing `ok: true`, notlisted `ok: false` with `code: 3` (`BGTaskSchedulerErrorCodeNotPermitted`). Record H10.
- [ ] **Step 4 (owner): Check the Health grant (Review Focus 1).** In the Health app, go to profile > Apps > CompanionSpike: every listed type is on. This screen is the only grant check: `Health status` says only whether the sheet was answered (`unnecessary` after any answer, `shouldRequest` if never asked). Repeat this check before every route or heart-rate conclusion.
- [ ] **Step 5 (owner): Daytime runs, days 2-7 (H1, H3).** For each outdoor run with this build installed, R1 to R3 included, note whether the phone was locked when the workout ended, and leave the app closed for 60 minutes; then pull. Record the first `wake` delay (`endAgoSec`) and its trigger, `route` and `hr` at the first read, and the `H3 arrive` delays. The H1 verdict is "immediate" when wakes with the phone unlocked come under 300 s, and "hourly" when they cluster up to 3,600 s.
- [ ] **Step 6 (owner): Heart-rate source (H5, H6).** If a Bluetooth chest strap is available, do one run with it paired to the Watch and compare its `H5` line with a run without one; otherwise record "not run: no strap". Record H6 from the `H6` lines.
- [ ] **Step 7 (owner): Health Auto Export (H9).** If Health Auto Export is installed, compare its workout `id` for one run with that run's `w8`; otherwise record "not run".
- [ ] **Step 8 (owner): Locked night, two trials (stop c, Review Focus 2).** A trial counts only after a logged `launch`, with the app not swiped away, Settings > General > Background App Refresh on for CompanionSpike and Low Power Mode off; note each before the evening. In the evening, record an outdoor run of at least 10 minutes with the phone locked before it ends. Keep the phone locked for at least 6 hours (charging allowed, noted). In the morning, unlock once, note the time, and leave the app closed for 60 minutes; then pull. Record any wake or `protected` read of that workout within 60 minutes of the unlock, its delay, and whether the route and heart rate were present.
- [ ] **Step 9: Record rows (c) and (d).** Row (c) is go if a valid trial logs an `H1 read` of the workout, triggered by `observer-*`, `protected` or `bg-*`, within 60 minutes of the first unlock (the hour of section 13's phase 4). It is no-go if two valid trials log none. Row (d) is go if every outdoor run with a confirmed grant has `route: true` at its first read, or an `H3 arrive route` within 24 hours. It is no-go if one does not while the Fitness app shows its map; a run with no map in Fitness is excluded.
- [ ] **Step 10 (owner): Force-quit (H4), last.** Swipe the app away and record a 10-minute workout. Unlock the phone several times over 60 minutes without opening the app, then open it. Record whether any `launch` line came before that manual open.
- [ ] **Step 11: Commit.** `test: record HealthKit background delivery`.

### Task 7: The upload over the tunnel (stop criterion e)
**Files:**
- Create: `server/upload-sink.mjs`, `CompanionSpike/Upload/UploadPayload.swift`, `CompanionSpike/Upload/UploadProbe.swift`, `CompanionSpike/Upload/UploadSession.swift`, `CompanionSpike/Probe/KeychainStore.swift`
- Modify: `CompanionSpike/AppDelegate.swift`: background session events. `CompanionSpike/Probe/HealthProbe.swift`: ping and enqueue. `CompanionSpike/Probe/BackgroundProbe.swift`: the refresh ping. `CompanionSpike/ContentView.swift`: a "Server" section with Origin, Token, Save, Ping, Ping http and Upload latest run. `spike.env`.
- Test: `CompanionSpikeTests/UploadPayloadTests.swift`

**Interfaces:**
- Consumes: `HealthProbe.store`, `HealthProbe.recentWorkouts(days:)`, `ProbeLog`.
- Produces:
```swift
struct UploadPayload: Encodable, Sendable {                    // design section 5.3 shape; nil fields are omitted
    struct Device: Encodable, Sendable { var name: String; var model: String; var externalHr: Bool }
    struct RoutePoint: Encodable, Sendable { var t: Double; var lat: Double; var lng: Double; var alt: Double? }; struct HrSample: Encodable, Sendable { var t: Double; var bpm: Double }
    struct Workout: Encodable, Sendable { var uuid: UUID; var activity: String; var indoor: Bool; var start: Date; var end: Date; var tz: String; var movingSec: Double; var distanceM: Double; var elevationGainM: Double?; var avgHr: Double?; var maxHr: Double?; var device: Device; var planId: UUID?; var route: [RoutePoint]?; var hr: [HrSample]? }
    var wire: Int = 1; var workout: Workout; func encoded() throws -> Data   // JSONEncoder, .iso8601 dates
}
enum KeychainStore { static let service = "companion-spike"; static func set(_ value: String, account: String) throws; static func get(_ account: String) -> String? }
enum UploadProbe { static func ping(context: String) async; static func pingInsecure() async; static func payload(for workout: HKWorkout) async throws -> UploadPayload; static func enqueue(_ workout: HKWorkout, context: String) async }
final class UploadSession: NSObject, URLSessionDataDelegate, @unchecked Sendable {   // .background(withIdentifier: bundle id + ".upload"), sessionSendsLaunchEvents true, isDiscretionary false
    static let shared: UploadSession; var backgroundCompletion: (() -> Void)?; func upload(file: URL, context: String) throws
}
```

- [ ] **Step 1: Write the failing tests.** The test-file helper `UploadPayload.sample(points: n)` builds n route points and n heart-rate samples with `t = Double(i)`, `lat = 10.0 + Double(i) * 0.0000123456789`, `lng = 20.0 + Double(i) * 0.0000098765432`, `alt = 250.0 + Double(i % 50) * 0.37` and `bpm = 140 + Double(i % 20)`; every optional summary field is nil.
```swift
@Test func encodesTheDesignShape() throws {
    let json = try JSONSerialization.jsonObject(with: UploadPayload.sample(points: 2).encoded()) as! [String: Any], w = json["workout"] as! [String: Any]
    #expect(json["wire"] as? Int == 1 && Set(w.keys) == ["uuid", "activity", "indoor", "start", "end", "tz", "movingSec", "distanceM", "device", "route", "hr"])
    #expect((w["route"] as? [[String: Any]])?.first?.keys.sorted() == ["alt", "lat", "lng", "t"]) }
@Test func aFiveHourRunFitsTheIngestLimit() throws {
    let data = try UploadPayload.sample(points: 18_000).encoded()
    print("SIZE raw=\(data.count) deflate=\(try (data as NSData).compressed(using: .zlib).count)")
    #expect(data.count < 16 * 1024 * 1024) }
```

- [ ] **Step 2: Run the tests.** `./spike.sh test` fails with `cannot find 'UploadPayload' in scope`.
- [ ] **Step 3: Implement `UploadPayload` and record N3.** Then `./spike.sh test 2>&1 | grep '^SIZE'` prints one line, and the run ends with `** TEST SUCCEEDED **`. Record the line in N3 beside section 5.3's "roughly 2 to 3 MB".
- [ ] **Step 4: Write `server/upload-sink.mjs`** (Node 22 or later, `node:http` only). It listens on `127.0.0.1:8787` and reads the token from `server/.token`, exiting 1 if the file is missing. `GET /spike/ping` returns 200 `{"ok":true}`. `POST /spike/upload` returns 401 `{"error":"unauthorized"}` without `Authorization: Bearer <token>`, 413 above 20 MiB, and 200 `{"ok":true}` otherwise. It appends one line per request to `server/received.jsonl`: `{t, event: "start"|"ping"|"upload"|"refused"|"heartbeat", bytes, w8, routePoints, hrSamples}`, plus a `heartbeat` line every 300 s. It never writes a body, a header value or an address.
- [ ] **Step 5 (owner): Start the sink on the Mac.** Run `openssl rand -hex 32 > server/.token`, then `caffeinate -s node server/upload-sink.mjs` in its own terminal, with the Mac on AC power and its lid open (record both; `-s` holds only on AC power, and a closed lid sleeps anyway). Run `tailscale serve --bg --https=8443 http://127.0.0.1:8787`. This needs MagicDNS and HTTPS certificates on in the admin console; enabling certificates publishes the machine name in Certificate Transparency logs. `tailscale serve status` lists `:8443` proxying to `http://127.0.0.1:8787`. Set `SPIKE_ORIGIN=https://<machine>.<tailnet>.ts.net:8443` in `spike.env`.
- [ ] **Step 6: Verify the sink from the Mac.** Run `source spike.env`, then check that: `curl -s "$SPIKE_ORIGIN/spike/ping"` prints `{"ok":true}`; `curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SPIKE_ORIGIN/spike/upload"` prints `401`; `curl -s -X POST -H "Authorization: Bearer $(cat server/.token)" -H 'Content-Type: application/json' --data '{"wire":1,"workout":{"uuid":"00000000-0000-4000-8000-000000000001","route":[],"hr":[]}}' "$SPIKE_ORIGIN/spike/upload"` prints `{"ok":true}`, and `tail -1 server/received.jsonl` shows `"event":"upload"` with `"w8":"00000000"`.
- [ ] **Step 7: Implement the app side with these rules.** **Save.** Accepts only an `https://` origin; anything else logs `N config {ok: false, reason: "scheme"}`. It stores the origin and token through `KeychainStore` (`kSecClassGenericPassword`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, `kSecAttrSynchronizable` false), then logs `N config {ok: true}` with no host. **Pings.** `ping` (10 s timeout, ephemeral session) logs `N1 ping {context, ok, status, ms, domain, code}`. `pingInsecure` requests the same host over `http://` and logs `N2 http {code}`. **The payload.** The route comes from `HKWorkoutRouteQueryDescriptor`, and the heart rate from `HKSampleQueryDescriptor` with `predicateForObjects(from:)`. `t` is seconds from the start, and `planId` is `workoutPlan?.id`. `externalHr` is true when any heart-rate sample's device `model` is not `"Watch"`. **`enqueue`.** Writes `Application Support/outbox/<uuid>.json` (`.completeUntilFirstUserAuthentication`, excluded from backup) and logs `N3 size {w8, bytes, deflateBytes, routePoints, hrSamples}`. Then it calls `UploadSession.shared.upload`, with `Authorization: Bearer` and the context in `taskDescription`. **The session delegate.** Logs `N1 upload {context, status, ms, domain, code}`, answers every redirect with `nil`, and calls `backgroundCompletion` on the main queue in `urlSessionDidFinishEvents`. `AppDelegate` stores that completion from `application(_:handleEventsForBackgroundURLSession:completionHandler:)`. **Triggers.** `catchUp` calls `ping(context: trigger)`, and `enqueue` for each new outdoor workout once its route is present. The refresh handler calls `ping(context: "bg-refresh")`.
- [ ] **Step 8 (owner): Check for an ATS key, then install.** `plutil -p CompanionSpike/Info.plist | grep -c NSAppTransportSecurity` prints `0`. `./spike.sh test` prints `** TEST SUCCEEDED **`; then run `./spike.sh build && ./spike.sh install && ./spike.sh launch`.
- [ ] **Step 9 (owner): Configure the app.** Run `pbcopy < server/.token`, paste the origin and token into Server, and Save. Record in N1 the Tailscale VPN On Demand state as shipped (Settings > VPN > Tailscale), and leave it unchanged.
- [ ] **Step 10 (owner): Cold pings (N1, N2).** Run three trials, each after the phone has been idle for at least 1 hour with the Tailscale app unopened: open the app, tap Ping, and record `ok` and `ms`. Then tap Ping http and expect `N2 http` code `-1022`. A successful `https` ping with no ATS key settles N2.
- [ ] **Step 11 (owner): Foreground upload (N3).** Tap Upload latest run. Expect `N3 size` and `N1 upload {context: "foreground", status: 200}`, with the sink's line showing the same `routePoints`. Record the real sizes in N3.
- [ ] **Step 12 (owner): Shared node.** If no second Tailscale account exists, create a free one on a second identity. Share the Mac's node to it, sign the iPhone's Tailscale app into that account, repeat Step 10 plus one background run, then sign the phone back into the first account. If this cannot be done, record "shared node not tested" and why.
- [ ] **Step 13 (owner): Background launches, days 4-7 (Review Focus 3).** Pull daily and `grep '"probe":"N1"'`. Per context (`observer-*`, `protected`, `bg-refresh`), record successful pings out of the total, uploads with status 200 out of the total, and the delay after the workout end. A failure counts only if `server/received.jsonl` has a `heartbeat` within 5 minutes both before and after it.
- [ ] **Step 14: Record row (e) and commit.** Row (e), which names the shared node, is go if at least 2 of its 3 cold foreground pings (Step 12) succeed within 10 s with On Demand untouched, and no-go if they do not; the tailnet-membership pings of Step 10 are recorded beside it. If Step 12 did not run, row (e) reads "open: shared node not tested", never go. The background success rate measures section 14's main risk but does not stop the build by itself: sections 3 and 14 already queue uploads until the next foreground. Commit `test: record uploads over the tunnel`.

### Task 8: Keychain survival after deleting the app (K1)
**Files:**
- Modify: `CompanionSpike/AppDelegate.swift` (the K1 read at launch and the install marker), `CompanionSpike/ContentView.swift` (the buttons "Write K1 probe" and "Marker: Survivor")

**Interfaces:**
- Consumes: `KeychainStore.set(_:account:)`, `KeychainStore.get(_:)`, `LimitProbes.marker`, `LimitProbes.minimal`, `HealthProbe.requestStatus()`.
- Produces: nothing.

- [ ] **Step 1: Implement the launch read and the button.** At launch the app logs `K1 launch` with: `found`: whether `get("k1-probe")` returned a value; `value8`: the value's first 8 characters; `marker`: whether `Application Support/installed.marker` exists; `scheduled`: the count of `scheduledWorkouts`; `hk`: the result of `requestStatus()`. It then creates the marker. "Write K1 probe" sets `k1-probe` to the current ISO 8601 time and logs `K1 write {value8}`.
- [ ] **Step 2 (owner): Write the probe.** Run `./spike.sh build && ./spike.sh install && ./spike.sh launch`. Tap Write K1 probe, then Marker: Survivor (`marker("Survivor", minimal("Survivor"), daysFromToday: 1, probe: "K1")`), and run `./spike.sh pull`.
- [ ] **Step 3 (owner): Delete the app.** Run `./spike.sh uninstall`, and record whether "Survivor" stays in the Watch's View More.
- [ ] **Step 4 (owner): Reinstall, record and commit.** Run `./spike.sh install && ./spike.sh launch && ./spike.sh pull`. Expected, per section 16 ("widely reported"): `found: true`, `value8` equal to the written value, and `marker: false`. Record `scheduled` and `hk`; `shouldRequest` means the HealthKit grant was removed with the app. Record K1 with the iOS version, and commit `test: record Keychain survival after deleting the app`.

### Task 9: Findings, go or no-go, and the docs PR
**Files:**
- Modify: `FINDINGS.md`
- Modify (running log, branch `docs/companion-phase0-results`): `docs/superpowers/specs/2026-11-09-apple-watch-companion-design.md`, section 16, plus the one API name in section 4

**Interfaces:**
- Consumes: `logs/*.jsonl`, `logs/support-simulator.txt`, `FINDINGS.md`.
- Produces: one docs PR in the running log.

- [ ] **Step 1: Complete the findings.** Every item line in `FINDINGS.md` holds a Result, its Evidence (log file and `probe`/`event`) and a date, or reads "not run: <reason>". Every stop row holds Observed and go or no-go. Add the two SDK facts found while planning: `HKHealthStore` declares no `isProtectedDataAvailable()` in the iOS 26.5 SDK, although section 4 names it; `UIApplication.isProtectedDataAvailable` is the API that exists. `BGTaskScheduler.h` documents `notPermitted` (code 3) for a missing `UIBackgroundModes` value or `BGTaskSchedulerPermittedIdentifiers` entry.
- [ ] **Step 2 (owner): Tear down the sink.** Run `tailscale serve --https=8443 off`, stop the sink and stop sharing the Mac's node (Task 7 Step 12); `tailscale serve status` no longer lists `:8443`.
- [ ] **Step 3: Check that the design is on `main`.** In the running log, `git ls-tree origin/main docs/superpowers/specs/2026-11-09-apple-watch-companion-design.md` prints one blob line. If it prints nothing, the design is still only on `docs/companion-design`: stop and ask the owner.
- [ ] **Step 4: Update section 16.** In a new worktree of the running log on branch `docs/companion-phase0-results` from `origin/main`, remove from section 16's bullets the items phase 0 settled. Add `### 16.1 Phase 0 results (<first day> to <last day>)`, with one line per settled item: `**W1, cap.** <result> (iOS <x>, watchOS <y>).` Add `### 16.2 Go or no-go`: a table `Criterion | Observed | Result` with rows (a) to (e) in section 13's wording. In section 4's "Locked phone" bullet, change `HKHealthStore.isProtectedDataAvailable()` to `UIApplication.shared.isProtectedDataAvailable`, and say so in 16.1. Name no device, host, tailnet, IP address, Apple ID, team, bundle id, run time or place.
- [ ] **Step 5: Scan for personal data.** Each command prints nothing: `git diff -U0 origin/main | grep '^+' | grep -nEi -e 'ts\.net' -e 'fd7a:115c:a1e0' -e '\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' -e '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'`; `git diff -U0 origin/main | grep '^+' | grep -nF -f <(sed -nE 's/^[A-Z_]+=(.+)$/\1/p' ~/src/companion-spike/spike.env)` (non-empty values only, since an empty pattern matches every line)
- [ ] **Step 6: Run the checks.** `npm ci && npm run check` exits 0.
- [ ] **Step 7: Commit, push and open the PR.** Commit `docs: record the companion phase 0 spike results`, and push with `git push -u origin docs/companion-phase0-results`. Run `gh pr create --title "docs: record the companion phase 0 spike results" --body "<the go or no-go table, the settled item ids, and: After merge: nothing to run.>"`, with no attribution lines. The owner merges after reading the checks.
- [ ] **Step 8: Commit the findings.** In `~/src/companion-spike`, commit `FINDINGS.md` with `docs: record the phase 0 findings`.
