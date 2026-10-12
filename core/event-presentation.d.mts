export type EventPresentation = {
  stageLabel: string;
  statusLabel: string;
  action: 'registration' | 'prize-list' | null;
  registrationCount: string;
};

export declare function eventPresentation(event: Record<string, unknown> | null | undefined): EventPresentation;
