export const TICKET_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ACCESS_LEVELS = ['VIEWER', 'MODERATOR', 'ADMIN', 'OWNER'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
