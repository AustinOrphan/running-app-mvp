import { GoalType, GoalPeriod } from './goals';

export interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  category: GoalTemplateCategory;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  type: GoalType;
  period: GoalPeriod;
  targetValue: number;
  targetUnit: string;
  icon: string;
  color: string;
  tags: string[];
  estimatedTimeframe: string;
  prerequisites?: string[];
  tips: string[];
  milestones?: Array<{
    percentage: number;
    description: string;
  }>;
}

export type GoalTemplateCategory = 
  | 'distance' 
  | 'speed' 
  | 'endurance' 
  | 'consistency' 
  | 'race_preparation' 
  | 'recovery'
  | 'technique';

export interface GoalTemplateCollection {
  category: GoalTemplateCategory;
  title: string;
  description: string;
  templates: GoalTemplate[];
}

export interface CreateGoalFromTemplate {
  templateId: string;
  customizations?: {
    targetValue?: number;
    period?: GoalPeriod;
    startDate?: string;
    endDate?: string;
    title?: string;
    description?: string;
  };
}