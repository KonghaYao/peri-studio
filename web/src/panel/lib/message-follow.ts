export interface MessageActivityItem {
  id: string;
  status: string | null;
  text?: string | null;
  toolCalls?: Array<{ status: string | null }> | null;
}

export const messageActivity = (entries: MessageActivityItem[]): string => entries.map((entry) =>
  `${entry.id}:${entry.status}:${String(entry.text || '').length}:${(entry.toolCalls || []).map((tool) => tool.status).join(',')}`,
).join('|');

export interface FollowStateInput {
  stick: boolean;
  hasNewContent: boolean;
  previousActivity: string | null;
  activity: string;
}

export interface FollowState {
  stick: boolean;
  hasNewContent: boolean;
  activity: string;
}

export const nextFollowState = ({ stick, hasNewContent, previousActivity, activity }: FollowStateInput): FollowState => {
  if (stick) return { stick: true, hasNewContent: false, activity };
  return {
    stick: false,
    hasNewContent: hasNewContent || (!!previousActivity && activity !== previousActivity),
    activity,
  };
};
