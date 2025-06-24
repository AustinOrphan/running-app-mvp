import { GoalTemplate, GoalTemplateCollection } from '../types/goalTemplates';

// Distance-based goal templates
const distanceTemplates: GoalTemplate[] = [
  {
    id: 'weekly-20k',
    name: 'Weekly 20K Challenge',
    description: 'Build up your weekly mileage to 20 kilometers',
    category: 'distance',
    difficulty: 'beginner',
    type: 'DISTANCE',
    period: 'WEEKLY',
    targetValue: 20,
    targetUnit: 'km',
    icon: '🏃‍♂️',
    color: '#3b82f6',
    tags: ['weekly', 'base building', 'endurance'],
    estimatedTimeframe: '4-6 weeks to establish',
    prerequisites: ['Ability to run 10K per week consistently'],
    tips: [
      'Increase weekly distance by no more than 10% each week',
      'Include one rest day between running days',
      'Focus on easy pace for most runs',
    ],
    milestones: [
      { percentage: 25, description: 'First 5K completed' },
      { percentage: 50, description: 'Halfway point - 10K done' },
      { percentage: 75, description: '15K completed - almost there!' },
      { percentage: 100, description: 'Full 20K weekly target achieved!' },
    ],
  },
  {
    id: 'monthly-100k',
    name: 'Monthly Century',
    description: 'Run 100 kilometers in a single month',
    category: 'distance',
    difficulty: 'intermediate',
    type: 'DISTANCE',
    period: 'MONTHLY',
    targetValue: 100,
    targetUnit: 'km',
    icon: '💯',
    color: '#10b981',
    tags: ['monthly', 'challenge', 'endurance'],
    estimatedTimeframe: '2-3 months to build up',
    prerequisites: ['Consistently running 60+ km per month'],
    tips: [
      'Aim for 3-4 runs per week',
      'Mix different run lengths',
      'Include one longer run each week',
      'Listen to your body and take rest days',
    ],
    milestones: [
      { percentage: 25, description: 'Quarter way - 25K completed' },
      { percentage: 50, description: 'Halfway point - 50K done' },
      { percentage: 75, description: 'Three quarters - 75K achieved' },
      { percentage: 100, description: 'Century achieved - 100K completed!' },
    ],
  },
  {
    id: 'half-marathon-distance',
    name: 'Half Marathon Distance',
    description: 'Complete a 21.1K run to prepare for half marathon racing',
    category: 'race_preparation',
    difficulty: 'intermediate',
    type: 'DISTANCE',
    period: 'CUSTOM',
    targetValue: 21.1,
    targetUnit: 'km',
    icon: '🏃‍♀️',
    color: '#8b5cf6',
    tags: ['race prep', 'half marathon', 'long run'],
    estimatedTimeframe: '8-12 weeks preparation',
    prerequisites: ['Comfortable running 10K', 'Base fitness established'],
    tips: [
      'Build up long run distance gradually',
      'Practice race pace during training',
      'Focus on fueling and hydration strategy',
      'Include recovery weeks in training',
    ],
  },
  {
    id: 'marathon-distance',
    name: 'Marathon Distance',
    description: 'Complete the ultimate running challenge - 42.2K',
    category: 'race_preparation',
    difficulty: 'advanced',
    type: 'DISTANCE',
    period: 'CUSTOM',
    targetValue: 42.2,
    targetUnit: 'km',
    icon: '🏅',
    color: '#ef4444',
    tags: ['race prep', 'marathon', 'ultimate challenge'],
    estimatedTimeframe: '16-20 weeks preparation',
    prerequisites: [
      'Half marathon completed',
      'Strong aerobic base',
      '6+ months consistent running',
    ],
    tips: [
      'Follow a structured training plan',
      'Practice nutrition during long runs',
      'Include strength training',
      'Prioritize recovery and sleep',
      'Mental preparation is crucial',
    ],
  },
];

// Speed-based goal templates
const speedTemplates: GoalTemplate[] = [
  {
    id: 'sub-30-5k',
    name: 'Sub-30 Minute 5K',
    description: 'Break the 30-minute barrier for 5K distance',
    category: 'speed',
    difficulty: 'beginner',
    type: 'TIME',
    period: 'CUSTOM',
    targetValue: 1800, // 30 minutes in seconds
    targetUnit: 'seconds',
    icon: '⚡',
    color: '#f59e0b',
    tags: ['5K', 'speed', 'personal best'],
    estimatedTimeframe: '6-8 weeks with focused training',
    prerequisites: ['Ability to run 5K continuously'],
    tips: [
      'Include interval training once per week',
      'Practice tempo runs at target pace',
      'Focus on consistent pacing',
      'Track your progress regularly',
    ],
  },
  {
    id: 'sub-25-5k',
    name: 'Sub-25 Minute 5K',
    description: 'Achieve a competitive 5K time under 25 minutes',
    category: 'speed',
    difficulty: 'intermediate',
    type: 'TIME',
    period: 'CUSTOM',
    targetValue: 1500, // 25 minutes in seconds
    targetUnit: 'seconds',
    icon: '🔥',
    color: '#ef4444',
    tags: ['5K', 'speed', 'competitive'],
    estimatedTimeframe: '8-12 weeks focused training',
    prerequisites: ['Sub-30 minute 5K achieved', 'Regular speed work experience'],
    tips: [
      'Include VO2 max intervals',
      'Practice race pace efforts',
      'Strengthen your core and legs',
      'Work on running form efficiency',
    ],
  },
  {
    id: 'sub-90-half-marathon',
    name: 'Sub-90 Minute Half Marathon',
    description: 'Achieve an elite amateur half marathon time',
    category: 'speed',
    difficulty: 'advanced',
    type: 'TIME',
    period: 'CUSTOM',
    targetValue: 5400, // 90 minutes in seconds
    targetUnit: 'seconds',
    icon: '🚀',
    color: '#6366f1',
    tags: ['half marathon', 'speed', 'elite amateur'],
    estimatedTimeframe: '16+ weeks specialized training',
    prerequisites: [
      'Sub-2 hour half marathon',
      'High weekly mileage',
      'Advanced training background',
    ],
    tips: [
      'High volume training required',
      'Advanced speed work protocols',
      'Professional coaching recommended',
      'Focus on lactate threshold development',
    ],
  },
];

// Consistency-based goal templates
const consistencyTemplates: GoalTemplate[] = [
  {
    id: 'run-3-times-weekly',
    name: 'Run 3 Times Per Week',
    description: 'Establish a consistent running routine',
    category: 'consistency',
    difficulty: 'beginner',
    type: 'FREQUENCY',
    period: 'WEEKLY',
    targetValue: 3,
    targetUnit: 'runs',
    icon: '📅',
    color: '#10b981',
    tags: ['consistency', 'habit building', 'routine'],
    estimatedTimeframe: '4 weeks to establish habit',
    prerequisites: ['Basic fitness level'],
    tips: [
      'Schedule runs on specific days',
      'Start with shorter runs',
      'Allow rest days between runs',
      'Track your consistency',
    ],
  },
  {
    id: 'daily-running-streak',
    name: '30-Day Running Streak',
    description: 'Run every day for 30 consecutive days',
    category: 'consistency',
    difficulty: 'intermediate',
    type: 'FREQUENCY',
    period: 'MONTHLY',
    targetValue: 30,
    targetUnit: 'days',
    icon: '🔥',
    color: '#ef4444',
    tags: ['streak', 'daily running', 'commitment'],
    estimatedTimeframe: '30 days',
    prerequisites: ['Established running base', 'Injury-free status'],
    tips: [
      'Some days can be very short runs',
      'Listen to your body',
      'Include easy recovery runs',
      'Have a backup indoor plan',
    ],
  },
  {
    id: 'run-5-times-weekly',
    name: 'Run 5 Times Per Week',
    description: 'Advanced consistency for serious runners',
    category: 'consistency',
    difficulty: 'advanced',
    type: 'FREQUENCY',
    period: 'WEEKLY',
    targetValue: 5,
    targetUnit: 'runs',
    icon: '💪',
    color: '#8b5cf6',
    tags: ['high frequency', 'serious training', 'advanced'],
    estimatedTimeframe: '6-8 weeks to establish',
    prerequisites: ['Running 3-4 times per week consistently', 'Good injury history'],
    tips: [
      'Include variety in training',
      'Monitor for overtraining signs',
      'Prioritize recovery',
      'Include easy days',
    ],
  },
];

// Endurance-based goal templates
const enduranceTemplates: GoalTemplate[] = [
  {
    id: 'longest-run-10k',
    name: 'First 10K Long Run',
    description: 'Complete your first 10 kilometer run',
    category: 'endurance',
    difficulty: 'beginner',
    type: 'LONGEST_RUN',
    period: 'CUSTOM',
    targetValue: 10,
    targetUnit: 'km',
    icon: '🎯',
    color: '#3b82f6',
    tags: ['10K', 'endurance', 'milestone'],
    estimatedTimeframe: '6-8 weeks from 5K base',
    prerequisites: ['Comfortable running 5K'],
    tips: [
      'Build distance gradually',
      'Focus on time on feet, not speed',
      'Stay hydrated',
      'Listen to your body',
    ],
  },
  {
    id: 'longest-run-15k',
    name: '15K Long Run Challenge',
    description: 'Push your endurance to 15 kilometers',
    category: 'endurance',
    difficulty: 'intermediate',
    type: 'LONGEST_RUN',
    period: 'CUSTOM',
    targetValue: 15,
    targetUnit: 'km',
    icon: '⭐',
    color: '#10b981',
    tags: ['15K', 'endurance building', 'progression'],
    estimatedTimeframe: '4-6 weeks from 10K base',
    prerequisites: ['Comfortable running 10K'],
    tips: [
      'Increase long run distance by 1-2K per week',
      'Practice fueling during longer runs',
      'Focus on conversational pace',
      'Plan rest day after long runs',
    ],
  },
  {
    id: 'longest-run-20k',
    name: '20K Ultra Endurance',
    description: 'Master the 20K distance for ultra endurance',
    category: 'endurance',
    difficulty: 'advanced',
    type: 'LONGEST_RUN',
    period: 'CUSTOM',
    targetValue: 20,
    targetUnit: 'km',
    icon: '🏆',
    color: '#8b5cf6',
    tags: ['20K', 'ultra preparation', 'advanced endurance'],
    estimatedTimeframe: '6-8 weeks from 15K base',
    prerequisites: ['Comfortable running 15K', 'Strong endurance base'],
    tips: [
      'Focus on time rather than pace',
      'Practice race nutrition',
      'Include walk breaks if needed',
      'Mental preparation important',
    ],
  },
];

// Race preparation templates
const raceTemplates: GoalTemplate[] = [
  {
    id: 'parkrun-sub-25',
    name: 'Parkrun Sub-25',
    description: 'Target a sub-25 minute Parkrun performance',
    category: 'race_preparation',
    difficulty: 'intermediate',
    type: 'TIME',
    period: 'CUSTOM',
    targetValue: 1500,
    targetUnit: 'seconds',
    icon: '🏃‍♂️',
    color: '#f59e0b',
    tags: ['parkrun', '5K race', 'community'],
    estimatedTimeframe: '8-10 weeks preparation',
    prerequisites: ['Regular parkrun participation', 'Sub-30 minute capability'],
    tips: [
      'Practice race pace during training',
      'Learn the course layout',
      'Include speed work weekly',
      'Taper properly before attempts',
    ],
  },
  {
    id: 'couch-to-5k',
    name: 'Couch to 5K Program',
    description: 'Complete your first 5K run from a sedentary start',
    category: 'race_preparation',
    difficulty: 'beginner',
    type: 'DISTANCE',
    period: 'CUSTOM',
    targetValue: 5,
    targetUnit: 'km',
    icon: '🌟',
    color: '#10b981',
    tags: ['beginner', 'first 5K', 'lifestyle change'],
    estimatedTimeframe: '9 weeks structured program',
    prerequisites: ['Medical clearance if needed', 'Commitment to consistency'],
    tips: [
      'Follow a structured plan',
      'Start with walk-run intervals',
      'Progress gradually',
      'Celebrate small victories',
      'Focus on completion, not speed',
    ],
  },
];

// Recovery and technique templates
const recoveryTemplates: GoalTemplate[] = [
  {
    id: 'easy-run-consistency',
    name: 'Easy Run Mastery',
    description: 'Learn to run at an easy, conversational pace',
    category: 'technique',
    difficulty: 'beginner',
    type: 'FREQUENCY',
    period: 'WEEKLY',
    targetValue: 2,
    targetUnit: 'easy runs',
    icon: '😌',
    color: '#6366f1',
    tags: ['easy pace', 'technique', 'base building'],
    estimatedTimeframe: '4-6 weeks to master',
    prerequisites: ['Basic running ability'],
    tips: [
      'Should be able to hold conversation',
      'Focus on form over speed',
      'Use heart rate monitor if available',
      'Majority of training should be easy',
    ],
  },
];

// Combine all templates into collections
export const GOAL_TEMPLATE_COLLECTIONS: GoalTemplateCollection[] = [
  {
    category: 'distance',
    title: 'Distance Goals',
    description: 'Build your weekly and monthly running volume',
    templates: distanceTemplates,
  },
  {
    category: 'speed',
    title: 'Speed Goals',
    description: 'Improve your pace and race times',
    templates: speedTemplates,
  },
  {
    category: 'consistency',
    title: 'Consistency Goals',
    description: 'Build sustainable running habits',
    templates: consistencyTemplates,
  },
  {
    category: 'endurance',
    title: 'Endurance Goals',
    description: 'Increase your longest run distances',
    templates: enduranceTemplates,
  },
  {
    category: 'race_preparation',
    title: 'Race Preparation',
    description: 'Train for specific race distances and events',
    templates: raceTemplates,
  },
  {
    category: 'technique',
    title: 'Technique & Recovery',
    description: 'Focus on running form and recovery',
    templates: recoveryTemplates,
  },
];

// Helper functions
export const getTemplateById = (templateId: string): GoalTemplate | undefined => {
  for (const collection of GOAL_TEMPLATE_COLLECTIONS) {
    const template = collection.templates.find(t => t.id === templateId);
    if (template) return template;
  }
  return undefined;
};

export const getTemplatesByCategory = (category: string): GoalTemplate[] => {
  const collection = GOAL_TEMPLATE_COLLECTIONS.find(c => c.category === category);
  return collection ? collection.templates : [];
};

export const getTemplatesByDifficulty = (difficulty: string): GoalTemplate[] => {
  return GOAL_TEMPLATE_COLLECTIONS.flatMap(collection => collection.templates).filter(
    template => template.difficulty === difficulty
  );
};

export const searchTemplates = (query: string): GoalTemplate[] => {
  const lowercaseQuery = query.toLowerCase();
  return GOAL_TEMPLATE_COLLECTIONS.flatMap(collection => collection.templates).filter(
    template =>
      template.name.toLowerCase().includes(lowercaseQuery) ||
      template.description.toLowerCase().includes(lowercaseQuery) ||
      template.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
  );
};
