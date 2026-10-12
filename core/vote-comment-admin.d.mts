export function hasVoteAdminPrivilege(value: unknown): boolean;
export function voteCommentRecommendation(
  row: unknown,
  adminType: unknown,
): { commentId: string; recommended: boolean } | null;
