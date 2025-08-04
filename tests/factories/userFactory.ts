import { User } from '@prisma/client';
import bcrypt from 'bcrypt';
import { testDb } from '../fixtures/testDatabase.js';

/**
 * User Factory
 * Functions for creating test users with various configurations
 */

export interface UserFactoryOptions {
  email?: string;
  password?: string;
  name?: string;
  id?: string;
}

export interface UserWithPassword extends User {
  plainPassword: string;
}

/**
 * Create a basic user
 */
export async function createUser(options: UserFactoryOptions = {}): Promise<UserWithPassword> {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substr(2, 9);

  const email = options.email || `test_${timestamp}@example.com`;
  const password = options.password || 'Test123\!@#';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await testDb.prisma.user.create({
    data: {
      id: options.id || `user_${timestamp}_${randomStr}`,
      email,
      password: hashedPassword,
      name: options.name || 'Test User',
    },
  });

  return {
    ...user,
    plainPassword: password,
  };
}

/**
 * Create multiple users for isolation testing
 */
export async function createMultipleUsers(
  count: number = 3,
  options: UserFactoryOptions = {}
): Promise<UserWithPassword[]> {
  const users: UserWithPassword[] = [];

  for (let i = 0; i < count; i++) {
    const user = await createUser({
      ...options,
      email: `user${i + 1}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}@test.com`,
      name: `Test User ${i + 1}`,
    });
    users.push(user);
  }

  return users;
}
