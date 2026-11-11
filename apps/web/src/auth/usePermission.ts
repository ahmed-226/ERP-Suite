import { useCallback } from 'react';
import type { Permission } from '@erp/shared';
import { useAuth } from './AuthContext';

/** Returns a predicate that checks the signed-in user's flattened permissions. */
export function usePermission() {
  const { user } = useAuth();
  return useCallback(
    (permission: Permission): boolean => user?.permissions.includes(permission) ?? false,
    [user],
  );
}
