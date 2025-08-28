# Training Science References and Sources

This document provides scientific sources and references for the algorithms, calculations, and training methodologies implemented in the Advanced Training Plan Generation System.

## Table of Contents

1. [VDOT and VO2max Calculations](#vdot-and-vo2max-calculations)
2. [Critical Speed and Power](#critical-speed-and-power)
3. [Training Load and TSS](#training-load-and-tss)
4. [Periodization Models](#periodization-models)
5. [Heart Rate Variability (HRV)](#heart-rate-variability-hrv)
6. [Running Economy](#running-economy)
7. [Training Distribution](#training-distribution)
8. [Injury Prevention](#injury-prevention)
9. [Additional Resources](#additional-resources)

---

## VDOT and VO2max Calculations

### Primary Sources

1. **Daniels, J. (2014).** _Daniels' Running Formula_ (3rd ed.). Human Kinetics.
   - ISBN: 978-1-4504-3183-5
   - The definitive source for VDOT calculations and training pace recommendations

2. **Daniels, J., & Gilbert, J. (1979).** _Oxygen Power: Performance Tables for Distance Runners_.
   - Original publication introducing the VDOT concept

### Implementation References

```
VDOT = (VO2max / %VO2max)
Where %VO2max = 0.8 + 0.1894393 * e^(-0.012778 * t) + 0.2989558 * e^(-0.1932605 * t)
```

### Supporting Research

- **Billat, V. L., et al. (1999).** "The concept of maximal lactate steady state." _Sports Medicine_, 27(6), 407-434.
- **Jones, A. M. (2006).** "The physiology of the world record holder for the women's marathon." _International Journal of Sports Science & Coaching_, 1(2), 101-116.

---

## Critical Speed and Power

### Primary Sources

1. **Jones, A. M., & Vanhatalo, A. (2017).** "The 'critical power' concept: Applications to sports performance with a focus on intermittent high-intensity exercise." _Sports Medicine_, 47(1), 65-78.
   - DOI: 10.1007/s40279-017-0688-0

2. **Poole, D. C., et al. (2016).** "Critical power: An important fatigue threshold in exercise physiology." _Medicine & Science in Sports & Exercise_, 48(11), 2320-2334.
   - DOI: 10.1249/MSS.0000000000000939

### Implementation Model

```
CS = (d2 - d1) / (t2 - t1)
```

Where CS = Critical Speed, d = distance, t = time

### Supporting Research

- **Morton, R. H. (2006).** "The critical power and related whole-body bioenergetic models." _European Journal of Applied Physiology_, 96(4), 339-354.

---

## Training Load and TSS

### Primary Sources

1. **Coggan, A. R., & Allen, H. (2010).** _Training and Racing with a Power Meter_ (2nd ed.). VeloPress.
   - Original source for Training Stress Score (TSS) concept

2. **Banister, E. W. (1991).** "Modeling elite athletic performance." In _Physiological Testing of Elite Athletes_, 403-424.
   - Foundation for impulse-response training models

### Implementation Formula

```
TSS = (duration_seconds × IF^2 × 100) / 3600
Where IF = Intensity Factor = NP / FTP
```

### Supporting Research

- **Busso, T. (2003).** "Variable dose-response relationship between exercise training and performance." _Medicine & Science in Sports & Exercise_, 35(7), 1188-1195.

---

## Periodization Models

### Primary Sources

1. **Issurin, V. B. (2016).** _Building the Modern Athlete: Scientific Advancements and Training Innovations_. Ultimate Athlete Concepts.
   - ISBN: 978-1-931046-05-5
   - Block periodization and modern training concepts

2. **Bompa, T. O., & Haff, G. G. (2009).** _Periodization: Theory and Methodology of Training_ (5th ed.). Human Kinetics.
   - ISBN: 978-0-7360-7483-4

### Nonlinear/Undulating Periodization

- **Kiely, J. (2012).** "Periodization paradigms in the 21st century: Evidence-led or tradition-driven?" _International Journal of Sports Physiology and Performance_, 7(3), 242-250.
- **Rhea, M. R., et al. (2002).** "A comparison of linear and daily undulating periodized programs with equated volume and intensity for strength." _Journal of Strength and Conditioning Research_, 16(2), 250-255.

---

## Heart Rate Variability (HRV)

### Primary Sources

1. **Plews, D. J., et al. (2013).** "Training adaptation and heart rate variability in elite endurance athletes: Opening the door to effective monitoring." _Sports Medicine_, 43(9), 773-781.
   - DOI: 10.1007/s40279-013-0071-8

2. **Buchheit, M. (2014).** "Monitoring training status with HR measures: Do all roads lead to Rome?" _Frontiers in Physiology_, 5, 73.
   - DOI: 10.3389/fphys.2014.00073

### Implementation Guidance

- HRV-guided training typically uses RMSSD (root mean square of successive differences)
- Recovery recommendations based on deviation from baseline

---

## Running Economy

### Primary Sources

1. **Barnes, K. R., & Kilding, A. E. (2015).** "Running economy: Measurement, norms, and determining factors." _Sports Medicine - Open_, 1(1), 8.
   - DOI: 10.1186/s40798-015-0007-y

2. **Saunders, P. U., et al. (2004).** "Factors affecting running economy in trained distance runners." _Sports Medicine_, 34(7), 465-485.

### Typical Values

- Elite runners: 180-200 ml/kg/km
- Recreational runners: 200-230 ml/kg/km

---

## Training Distribution

### Polarized Training Model (80/20)

1. **Seiler, S. (2010).** "What is best practice for training intensity and duration distribution in endurance athletes?" _International Journal of Sports Physiology and Performance_, 5(3), 276-291.

2. **Stöggl, T., & Sperlich, B. (2014).** "Polarized training has greater impact on key endurance variables than threshold, high intensity, or high volume training." _Frontiers in Physiology_, 5, 33.
   - DOI: 10.3389/fphys.2014.00033

### Implementation

- 80% of training at low intensity (Zones 1-2)
- 20% at high intensity (Zones 4-5)
- Minimal time in Zone 3 (threshold)

---

## Injury Prevention

### Acute:Chronic Workload Ratio

1. **Gabbett, T. J. (2016).** "The training—injury prevention paradox: Should athletes be training smarter and harder?" _British Journal of Sports Medicine_, 50(5), 273-280.
   - DOI: 10.1136/bjsports-2015-095788

2. **Hulin, B. T., et al. (2014).** "The acute:chronic workload ratio predicts injury: High chronic workload may decrease injury risk in elite rugby league players." _British Journal of Sports Medicine_, 48(2), 123-127.

### Safe Ratios

- 0.8-1.3: Sweet spot
- > 1.5: Increased injury risk
- <0.8: Detraining risk

---

## Additional Resources

### Books

1. **McMillan, G. (2017).** _YOU (Only Faster): The Official Run Faster Training Plans_.
2. **Fitzgerald, M. (2014).** _80/20 Running: Run Stronger and Race Faster by Training Slower_. Penguin.
3. **Magness, S. (2014).** _The Science of Running: How to Find Your Limit and Train to Maximize Your Performance_. Origin Press.

### Scientific Journals

- _International Journal of Sports Physiology and Performance_
- _Medicine & Science in Sports & Exercise_
- _Sports Medicine_
- _Journal of Applied Physiology_
- _European Journal of Applied Physiology_

### Online Resources

1. **Science of Running** - Steve Magness
   - Website: https://www.scienceofrunning.com/

2. **Training Peaks Articles**
   - Various evidence-based training articles

3. **Alan Couzens' Blog**
   - Evidence-based endurance training

### Training Software References

- **WKO5** - Advanced analytics software by TrainingPeaks
- **Golden Cheetah** - Open-source performance analysis
- **Stryd** - Running power and efficiency metrics

---

## Implementation Notes

All calculations and methodologies in our Advanced Training Plan Generation System are based on peer-reviewed research and established sports science principles. The specific implementations may be simplified or adapted for practical use while maintaining scientific validity.

### Key Principles Applied:

1. **Progressive Overload** - Gradual increase in training stimulus
2. **Specificity** - Training adaptations specific to demands
3. **Reversibility** - Use it or lose it principle
4. **Individual Differences** - Personalization based on fitness level
5. **Recovery** - Adaptation occurs during rest
6. **Variation** - Preventing staleness and overtraining

---

_Last Updated: [Current Date]_
_Note: This is a living document and will be updated as new research becomes available._
