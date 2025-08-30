import { User, Run, Goal, Race } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  generateEmail,
  generatePassword,
  generateGeoJSON,
  generateGoalColor,
  generateGoalIcon,
  generateRunNotes,
  generateRunTag,
} from './commonFactory.js';

/**
 * Builder Pattern Implementation for Test Data
 * Provides fluent API for creating complex test objects with related data
 */

// Base builder interface
interface Builder<T> {
  build(): Promise<T>;
}

/**
 * User Builder
 */
export class UserBuilder implements Builder<User> {
  private data: Partial<User & { plainPassword?: string }> = {};

  withEmail(email: string): this {
    this.data.email = email;
    return this;
  }

  withName(name: string): this {
    this.data.name = name;
    return this;
  }

  withPassword(password: string): this {
    this.data.plainPassword = password;
    return this;
  }

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  async build(): Promise<User & { plainPassword: string }> {
    const email = this.data.email || generateEmail();
    const name = this.data.name || 'Test User';
    const plainPassword = this.data.plainPassword || generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const id = this.data.id || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Note: This is just building the data structure, not saving to DB
    return {
      id,
      email,
      name,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
      plainPassword,
    } as User & { plainPassword: string };
  }
}

/**
 * Run Builder
 */
export class RunBuilder implements Builder<Omit<Run, 'id' | 'createdAt' | 'updatedAt'>> {
  private data: Partial<Run> = {};

  withUserId(userId: string): this {
    this.data.userId = userId;
    return this;
  }

  withDate(date: Date): this {
    this.data.date = date;
    return this;
  }

  withDistance(distance: number): this {
    this.data.distance = distance;
    return this;
  }

  withDuration(duration: number): this {
    this.data.duration = duration;
    return this;
  }

  withTag(tag: string): this {
    this.data.tag = tag;
    return this;
  }

  withNotes(notes: string): this {
    this.data.notes = notes;
    return this;
  }

  withRoute(points: number = 100): this {
    this.data.routeGeoJson = generateGeoJSON(points);
    return this;
  }

  asEasyRun(): this {
    return this.withTag('Easy Run')
      .withDistance(5 + Math.random() * 5)
      .withDuration(1800 + Math.random() * 1800);
  }

  asLongRun(): this {
    return this.withTag('Long Run')
      .withDistance(15 + Math.random() * 10)
      .withDuration(4500 + Math.random() * 3600);
  }

  asSpeedWork(): this {
    return this.withTag('Speed Work')
      .withDistance(8 + Math.random() * 4)
      .withDuration(2400 + Math.random() * 1200);
  }

  yesterdayRun(): this {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return this.withDate(yesterday);
  }

  lastWeekRun(): this {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    return this.withDate(lastWeek);
  }

  async build(): Promise<Omit<Run, 'id' | 'createdAt' | 'updatedAt'>> {
    if (!this.data.userId) {
      throw new Error('UserId is required for Run');
    }

    return {
      userId: this.data.userId,
      date: this.data.date || new Date(),
      distance: this.data.distance || 5.0,
      duration: this.data.duration || 1800,
      tag: this.data.tag || generateRunTag(),
      notes: this.data.notes || generateRunNotes(),
      routeGeoJson: this.data.routeGeoJson || null,
    };
  }
}

/**
 * Goal Builder
 */
export class GoalBuilder implements Builder<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>> {
  private data: Partial<Goal> = {};

  withUserId(userId: string): this {
    this.data.userId = userId;
    return this;
  }

  withTitle(title: string): this {
    this.data.title = title;
    return this;
  }

  withDescription(description: string): this {
    this.data.description = description;
    return this;
  }

  withType(type: string): this {
    this.data.type = type;
    return this;
  }

  withPeriod(period: string): this {
    this.data.period = period;
    return this;
  }

  withTarget(value: number, unit: string = 'km'): this {
    this.data.targetValue = value;
    this.data.targetUnit = unit;
    return this;
  }

  withProgress(current: number): this {
    this.data.currentValue = current;
    return this;
  }

  withDateRange(start: Date, end: Date): this {
    this.data.startDate = start;
    this.data.endDate = end;
    return this;
  }

  withColor(color: string): this {
    this.data.color = color;
    return this;
  }

  withIcon(icon: string): this {
    this.data.icon = icon;
    return this;
  }

  asDistanceGoal(targetKm: number = 100): this {
    return this.withType('DISTANCE')
      .withTarget(targetKm, 'km')
      .withTitle(`Run ${targetKm}km`)
      .withDescription(`Complete ${targetKm} kilometers`);
  }

  asFrequencyGoal(runsPerWeek: number = 4): this {
    return this.withType('FREQUENCY')
      .withPeriod('WEEKLY')
      .withTarget(runsPerWeek, 'runs')
      .withTitle(`Run ${runsPerWeek} times per week`)
      .withDescription(`Complete ${runsPerWeek} runs every week`);
  }

  asTimeGoal(minutes: number = 600): this {
    return this.withType('TIME')
      .withTarget(minutes, 'minutes')
      .withTitle(`Run for ${minutes} minutes`)
      .withDescription(`Complete ${minutes} minutes of running`);
  }

  asPaceGoal(secondsPerKm: number = 300): this {
    const paceMinutes = Math.floor(secondsPerKm / 60);
    const paceSeconds = secondsPerKm % 60;
    return this.withType('PACE')
      .withTarget(secondsPerKm, 'sec/km')
      .withTitle(`Maintain ${paceMinutes}:${paceSeconds.toString().padStart(2, '0')} pace`)
      .withDescription(
        `Maintain average pace of ${paceMinutes}:${paceSeconds.toString().padStart(2, '0')} per km`
      );
  }

  asMonthlyGoal(): this {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);

    return this.withPeriod('MONTHLY').withDateRange(start, end);
  }

  asWeeklyGoal(): this {
    const start = new Date();
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return this.withPeriod('WEEKLY').withDateRange(start, end);
  }

  asCompleted(): this {
    this.data.isCompleted = true;
    this.data.completedAt = new Date();
    this.data.currentValue = this.data.targetValue || 100;
    return this;
  }

  withProgressPercentage(percentage: number): this {
    const target = this.data.targetValue || 100;
    return this.withProgress((target * percentage) / 100);
  }

  async build(): Promise<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>> {
    if (!this.data.userId) {
      throw new Error('UserId is required for Goal');
    }

    const now = new Date();
    const startDate = this.data.startDate || now;
    const endDate = this.data.endDate || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      userId: this.data.userId,
      title: this.data.title || 'Test Goal',
      description: this.data.description || 'Test goal description',
      type: this.data.type || 'DISTANCE',
      period: this.data.period || 'MONTHLY',
      targetValue: this.data.targetValue || 100,
      targetUnit: this.data.targetUnit || 'km',
      startDate,
      endDate,
      currentValue: this.data.currentValue || 0,
      isCompleted: this.data.isCompleted || false,
      completedAt: this.data.completedAt || null,
      color: this.data.color || generateGoalColor(),
      icon: this.data.icon || generateGoalIcon(),
      isActive: this.data.isActive !== undefined ? this.data.isActive : true,
    };
  }
}

/**
 * Race Builder
 */
export class RaceBuilder implements Builder<Omit<Race, 'id' | 'createdAt' | 'updatedAt'>> {
  private data: Partial<Race> = {};

  withUserId(userId: string): this {
    this.data.userId = userId;
    return this;
  }

  withName(name: string): this {
    this.data.name = name;
    return this;
  }

  withDate(date: Date): this {
    this.data.raceDate = date;
    return this;
  }

  withDistance(distance: number): this {
    this.data.distance = distance;
    return this;
  }

  withTargetTime(seconds: number): this {
    this.data.targetTime = seconds;
    return this;
  }

  withActualTime(seconds: number): this {
    this.data.actualTime = seconds;
    return this;
  }

  withNotes(notes: string): this {
    this.data.notes = notes;
    return this;
  }

  as5K(): this {
    return this.withDistance(5).withName('5K Race').withTargetTime(1200); // 20 minutes
  }

  as10K(): this {
    return this.withDistance(10).withName('10K Race').withTargetTime(2700); // 45 minutes
  }

  asHalfMarathon(): this {
    return this.withDistance(21.1).withName('Half Marathon').withTargetTime(7200); // 2 hours
  }

  asMarathon(): this {
    return this.withDistance(42.195).withName('Marathon').withTargetTime(14400); // 4 hours
  }

  upcomingRace(daysFromNow: number = 30): this {
    const raceDate = new Date();
    raceDate.setDate(raceDate.getDate() + daysFromNow);
    return this.withDate(raceDate);
  }

  pastRace(daysAgo: number = 30): this {
    const raceDate = new Date();
    raceDate.setDate(raceDate.getDate() - daysAgo);
    return this.withDate(raceDate);
  }

  asCompleted(actualTimeSeconds?: number): this {
    const targetTime = this.data.targetTime || 3600;
    const actualTime =
      actualTimeSeconds || targetTime + Math.floor((Math.random() - 0.5) * targetTime * 0.1);
    return this.withActualTime(actualTime);
  }

  async build(): Promise<Omit<Race, 'id' | 'createdAt' | 'updatedAt'>> {
    if (!this.data.userId) {
      throw new Error('UserId is required for Race');
    }

    return {
      userId: this.data.userId,
      name: this.data.name || 'Test Race',
      raceDate: this.data.raceDate || new Date(),
      distance: this.data.distance || 10,
      targetTime: this.data.targetTime || null,
      actualTime: this.data.actualTime || null,
      notes: this.data.notes || null,
    };
  }
}

/**
 * Factory functions for builders
 */
export const user = () => new UserBuilder();
export const run = () => new RunBuilder();
export const goal = () => new GoalBuilder();
export const race = () => new RaceBuilder();

/**
 * Composite builder for complex scenarios
 */
export class ScenarioBuilder {
  private users: UserBuilder[] = [];
  private runs: Array<{ userIndex: number; run: RunBuilder }> = [];
  private goals: Array<{ userIndex: number; goal: GoalBuilder }> = [];
  private races: Array<{ userIndex: number; race: RaceBuilder }> = [];

  addUser(builderFn?: (builder: UserBuilder) => UserBuilder): this {
    const builder = user();
    this.users.push(builderFn ? builderFn(builder) : builder);
    return this;
  }

  addRunForUser(userIndex: number, builderFn?: (builder: RunBuilder) => RunBuilder): this {
    const builder = run();
    this.runs.push({
      userIndex,
      run: builderFn ? builderFn(builder) : builder,
    });
    return this;
  }

  addGoalForUser(userIndex: number, builderFn?: (builder: GoalBuilder) => GoalBuilder): this {
    const builder = goal();
    this.goals.push({
      userIndex,
      goal: builderFn ? builderFn(builder) : builder,
    });
    return this;
  }

  addRaceForUser(userIndex: number, builderFn?: (builder: RaceBuilder) => RaceBuilder): this {
    const builder = race();
    this.races.push({
      userIndex,
      race: builderFn ? builderFn(builder) : builder,
    });
    return this;
  }

  async build() {
    // Build users first
    const builtUsers = await Promise.all(this.users.map(u => u.build()));

    // Build runs with user IDs
    const builtRuns = await Promise.all(
      this.runs.map(async ({ userIndex, run }) => {
        return run.withUserId(builtUsers[userIndex].id).build();
      })
    );

    // Build goals with user IDs
    const builtGoals = await Promise.all(
      this.goals.map(async ({ userIndex, goal }) => {
        return goal.withUserId(builtUsers[userIndex].id).build();
      })
    );

    // Build races with user IDs
    const builtRaces = await Promise.all(
      this.races.map(async ({ userIndex, race }) => {
        return race.withUserId(builtUsers[userIndex].id).build();
      })
    );

    return {
      users: builtUsers,
      runs: builtRuns,
      goals: builtGoals,
      races: builtRaces,
    };
  }
}

export const scenario = () => new ScenarioBuilder();
