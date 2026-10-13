export type VideoNetwork = { type?: string; saveData?: boolean };
export type VideoAutoloadPreferences = { autoLoadVideoWhenWifi?: boolean };
export function shouldAutoLoadVideoWhenWifi(preferences: VideoAutoloadPreferences | null | undefined, network: VideoNetwork | null | undefined, visible: boolean): boolean;
