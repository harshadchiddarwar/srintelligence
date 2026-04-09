/**
 * user-service.ts — thin compatibility shim that re-exports
 * UserPreferencesManager as `userService` for API routes.
 */
export { UserPreferencesManager as UserService } from '../user/preferences';

import { UserPreferencesManager } from '../user/preferences';
export const userService = UserPreferencesManager.getInstance();
