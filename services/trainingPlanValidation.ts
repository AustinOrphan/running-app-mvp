export class TrainingPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrainingPlanValidationError';
  }
}

/**
 * Validate training plan configuration inputs
 */
export function validateTrainingConfig(config: {
  userId: string;
  name: string;
  startDate: Date;
  endDate?: Date;
  currentFitnessLevel?: {
    weeklyMileage: number;
    longestRecentRun: number;
  };
}): void {
  if (!config.userId || config.userId.length === 0) {
    throw new TrainingPlanValidationError('User ID is required');
  }

  if (!config.name || config.name.trim().length === 0) {
    throw new TrainingPlanValidationError('Training plan name is required');
  }
  if (config.name.length > 100) {
    throw new TrainingPlanValidationError('Training plan name must be 100 characters or less');
  }

  if (!(config.startDate instanceof Date) || isNaN(config.startDate.getTime())) {
    throw new TrainingPlanValidationError('Valid start date is required');
  }

  if (config.endDate) {
    if (!(config.endDate instanceof Date) || isNaN(config.endDate.getTime())) {
      throw new TrainingPlanValidationError('End date must be a valid date');
    }
    if (config.endDate <= config.startDate) {
      throw new TrainingPlanValidationError('End date must be after start date');
    }

    const maxDuration = 365 * 2;
    const durationDays = Math.floor(
      (config.endDate.getTime() - config.startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (durationDays > maxDuration) {
      throw new TrainingPlanValidationError(`Training plan cannot exceed ${maxDuration} days`);
    }
  }

  if (config.currentFitnessLevel) {
    const { weeklyMileage, longestRecentRun } = config.currentFitnessLevel;

    if (weeklyMileage !== undefined) {
      if (weeklyMileage < 0) {
        throw new TrainingPlanValidationError('Weekly mileage cannot be negative');
      }
      if (weeklyMileage > 300) {
        throw new TrainingPlanValidationError('Weekly mileage seems unrealistic (max 300km)');
      }
    }

    if (longestRecentRun !== undefined) {
      if (longestRecentRun < 0) {
        throw new TrainingPlanValidationError('Longest run cannot be negative');
      }
      if (longestRecentRun > 100) {
        throw new TrainingPlanValidationError('Longest run seems unrealistic (max 100km)');
      }
      if (weeklyMileage && longestRecentRun > weeklyMileage) {
        throw new TrainingPlanValidationError('Longest run cannot exceed weekly mileage');
      }
    }
  }
}

/**
 * Sanitize text input (notes, descriptions)
 */
export function sanitizeTextInput(text: string | null | undefined): string | null {
  if (!text) return null;

  return text
    .trim()
    .replace(/\0/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .substring(0, 10000);
}
