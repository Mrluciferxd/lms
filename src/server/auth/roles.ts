/**
 * Roles and permissions.
 *
 * Deliberately capability-based rather than a linear hierarchy. A linear ranking
 * would force an answer to "is an instructor above or below ops staff?", and
 * there isn't one — they are orthogonal. An instructor authors content and
 * reviews student work but has no business issuing refunds; ops staff track fees
 * and attendance but should not be editing curriculum.
 *
 * Encoding that as a permission matrix keeps each check honest about what it
 * actually needs, and means adding a role later does not renumber anything.
 *
 * Edge-safe: no Prisma import, so middleware can use it.
 */

import type { Role } from '@/generated/prisma/enums'

export type Permission =
  // Catalog
  | 'course:read'
  | 'course:write'
  | 'course:publish'
  // Cohorts
  | 'batch:manage'
  | 'enrollment:manage'
  // Students
  | 'student:read'
  | 'student:manage'
  | 'student:impersonate'
  // Delivery
  | 'session:manage'
  | 'attendance:mark'
  | 'assignment:manage'
  | 'assignment:grade'
  // Money
  | 'payment:read'
  | 'payment:manage'
  | 'fee:manage'
  // Communication
  | 'notification:send'
  | 'notification:manage'
  | 'chat:moderate'
  // Verticals
  | 'journal:review'
  | 'journal:define'
  | 'tracker:manage'
  // Administration
  | 'settings:manage'
  | 'media:upload'
  | 'audit:read'
  | 'org:transfer'

const STUDENT_PERMISSIONS: readonly Permission[] = ['course:read']

const INSTRUCTOR_PERMISSIONS: readonly Permission[] = [
  'course:read',
  'course:write',
  'batch:manage',
  'student:read',
  'session:manage',
  'attendance:mark',
  'assignment:manage',
  'assignment:grade',
  'notification:send',
  'chat:moderate',
  'journal:review',
  'media:upload',
]

/** Operations: money, enrollment and day-to-day student administration. */
const STAFF_PERMISSIONS: readonly Permission[] = [
  'course:read',
  'student:read',
  'student:manage',
  'enrollment:manage',
  'attendance:mark',
  'payment:read',
  'payment:manage',
  'fee:manage',
  'notification:send',
  'session:manage',
]

const ADMIN_PERMISSIONS: readonly Permission[] = [
  'course:read',
  'course:write',
  'course:publish',
  'batch:manage',
  'enrollment:manage',
  'student:read',
  'student:manage',
  'student:impersonate',
  'session:manage',
  'attendance:mark',
  'assignment:manage',
  'assignment:grade',
  'payment:read',
  'payment:manage',
  'fee:manage',
  'notification:send',
  'notification:manage',
  'chat:moderate',
  'journal:review',
  'journal:define',
  'tracker:manage',
  'settings:manage',
  'media:upload',
  'audit:read',
]

/** Owner is admin plus the irreversible operations. */
const OWNER_PERMISSIONS: readonly Permission[] = [...ADMIN_PERMISSIONS, 'org:transfer']

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  STUDENT: STUDENT_PERMISSIONS,
  INSTRUCTOR: INSTRUCTOR_PERMISSIONS,
  STAFF: STAFF_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  OWNER: OWNER_PERMISSIONS,
}

/** Roles with access to /admin. */
export const STAFF_ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF']

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role)
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  INSTRUCTOR: 'Instructor',
  STAFF: 'Staff',
  STUDENT: 'Student',
}
