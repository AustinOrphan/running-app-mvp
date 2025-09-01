import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { createNotFoundError, createForbiddenError } from './errorHandler.js';
import { AuthRequest } from './requireAuth.js';

/**
 * Ownership middleware for resource authorization
 * Eliminates duplicate ownership checks across route handlers
 */

interface OwnershipOptions {
  resourceType: 'goal' | 'run' | 'race';
  paramName?: string; // Default: 'id'
  allowOwnerOnly?: boolean; // Default: true
}

/**
 * Middleware to verify resource ownership
 * Attaches the resource to req.resource for use in route handlers
 */
export const verifyOwnership = (options: OwnershipOptions) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { resourceType, paramName = 'id', allowOwnerOnly = true } = options;
      const resourceId = req.params[paramName];
      const userId = req.user!.id;

      let resource;

      // Fetch the resource based on type
      switch (resourceType) {
        case 'goal':
          resource = await prisma.goal.findUnique({
            where: { id: resourceId },
          });
          break;

        case 'run':
          resource = await prisma.run.findUnique({
            where: { id: resourceId },
          });
          break;

        case 'race':
          resource = await prisma.race.findUnique({
            where: { id: resourceId },
          });
          break;

        default:
          throw new Error(`Unsupported resource type: ${resourceType}`);
      }

      // Check if resource exists
      if (!resource) {
        throw createNotFoundError(
          resourceType.charAt(0).toUpperCase() + resourceType.slice(1)
        );
      }

      // Check ownership if required
      if (allowOwnerOnly && resource.userId !== userId) {
        throw createForbiddenError(
          `You do not have permission to access this ${resourceType}`
        );
      }

      // Attach resource to request for use in route handler
      (req as any).resource = resource;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Convenience middleware for goal ownership verification
 */
export const verifyGoalOwnership = verifyOwnership({ resourceType: 'goal' });

/**
 * Convenience middleware for run ownership verification
 */
export const verifyRunOwnership = verifyOwnership({ resourceType: 'run' });

/**
 * Convenience middleware for race ownership verification
 */
export const verifyRaceOwnership = verifyOwnership({ resourceType: 'race' });

/**
 * Extended AuthRequest interface that includes the verified resource
 */
export interface ResourceAuthRequest extends AuthRequest {
  resource: {
    id: string;
    userId: string;
    [key: string]: any;
  };
}