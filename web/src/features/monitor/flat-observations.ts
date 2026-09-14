import type {
  MonitorObservationView,
  MonitorTimelineSegment,
  MonitorTraceObservationFlat,
  ScoreListShellItem,
} from '@peri/ui';
import { parseMaybeString } from '@peri/ui';

export type ObservationStatChipView = {
  key: 'duration' | 'model' | 'tokens';
  label: string;
  value: string;
};

function formatObservationDuration(latencyMs: number): string {
  if (latencyMs < 1000) return `${latencyMs}ms`;
  return `${(latencyMs / 1000).toFixed(2)}s`;
}

function formatObservationTokens(observation: MonitorObservationView): string | null {
  const { inputTokens, outputTokens, tokens, kind } = observation;
  if (
    inputTokens !== undefined
    && outputTokens !== undefined
    && Number.isFinite(inputTokens)
    && Number.isFinite(outputTokens)
  ) {
    const sum = inputTokens + outputTokens;
    return `${inputTokens.toLocaleString()} → ${outputTokens.toLocaleString()} (Σ ${sum.toLocaleString()})`;
  }
  if (tokens !== undefined && Number.isFinite(tokens)) {
    if (kind?.toUpperCase() === 'GENERATION') {
      return `${tokens.toLocaleString()} tok`;
    }
    return `${tokens.toLocaleString()} tok`;
  }
  return null;
}

function adaptObservationScoreItem(observation: MonitorObservationView): ScoreListShellItem | null {
  if (!observation.scoreValue) return null;

  const item: ScoreListShellItem = {
    id: observation.id,
    name: observation.name,
    source: observation.scoreDataType ?? 'SCORE',
  };

  const numeric = Number(observation.scoreValue);
  if (observation.scoreDataType?.toUpperCase() === 'NUMERIC' && Number.isFinite(numeric)) {
    item.value = numeric;
    return item;
  }
  if (Number.isFinite(numeric) && observation.scoreValue.trim() !== '') {
    item.value = numeric;
    return item;
  }

  item.textValue = observation.scoreValue;
  return item;
}

/** 详情 StatChip 行：仅返回有值的 duration / model / tokens。 */
export function buildObservationStatChips(observation: MonitorObservationView): ObservationStatChipView[] {
  const chips: ObservationStatChipView[] = [];

  if (observation.latencyMs !== undefined && Number.isFinite(observation.latencyMs)) {
    chips.push({
      key: 'duration',
      label: 'Duration',
      value: formatObservationDuration(observation.latencyMs),
    });
  }
  if (observation.model) {
    chips.push({
      key: 'model',
      label: 'Model',
      value: observation.model,
    });
  }

  const tokens = formatObservationTokens(observation);
  if (tokens) {
    chips.push({
      key: 'tokens',
      label: 'Tokens',
      value: tokens,
    });
  }

  return chips;
}

/** 将 observation 自身与子 SCORE 节点适配为 ScoreListShell 项。 */
export function buildObservationScoreList(observation: MonitorObservationView): ScoreListShellItem[] {
  const scores: ScoreListShellItem[] = [];
  const seen = new Set<string>();

  const push = (candidate: MonitorObservationView) => {
    const item = adaptObservationScoreItem(candidate);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    scores.push(item);
  };

  if (observation.scoreValue) {
    push(observation);
  }

  for (const child of observation.children ?? []) {
    if (child.kind.toUpperCase() === 'SCORE' || child.scoreValue) {
      push(child);
    }
  }

  return scores;
}

type FlatObservationDraft = Omit<MonitorTraceObservationFlat, 'startTime' | 'endTime'> & {
  latencyMs?: number;
};

function parseObservationIo(preview: string | undefined): unknown {
  if (!preview) return undefined;
  return parseMaybeString(preview);
}

function flattenObservationTree(
  observations: MonitorObservationView[],
  parentId: string | null,
  drafts: FlatObservationDraft[],
): void {
  for (const observation of observations) {
    const draft: FlatObservationDraft = {
      id: observation.id,
      parentId,
      type: observation.kind,
      name: observation.name,
      level: observation.level,
      inputTokens: observation.inputTokens,
      outputTokens: observation.outputTokens,
      totalTokens: observation.tokens,
      latencyMs: observation.latencyMs,
    };

    const outputData = parseObservationIo(observation.outputPreview);
    if (outputData !== undefined) {
      draft.output = outputData;
    } else if (observation.scoreValue) {
      draft.output = {
        value: observation.scoreValue,
        dataType: observation.scoreDataType ?? null,
      };
    }

    drafts.push(draft);
    if (observation.children?.length) {
      flattenObservationTree(observation.children, observation.id, drafts);
    }
  }
}

function assignSyntheticTimestamps(
  drafts: FlatObservationDraft[],
  traceTimestamp: string,
): MonitorTraceObservationFlat[] {
  const baseMs = Date.parse(traceTimestamp);
  const cursorStart = Number.isFinite(baseMs) ? baseMs : Date.now();
  let cursor = cursorStart;

  return drafts.map((draft) => {
    const durationMs = draft.latencyMs && draft.latencyMs > 0 ? draft.latencyMs : 1;
    const startTime = new Date(cursor).toISOString();
    const endTime = new Date(cursor + durationMs).toISOString();
    cursor += durationMs;
    const { latencyMs: _latencyMs, ...rest } = draft;
    return {
      ...rest,
      startTime,
      endTime,
    };
  });
}

/** 将 server 预构建 observation 树适配为 MonitorTraceTurnTree 所需的扁平列表。 */
export function flattenMonitorObservations(
  observations: MonitorObservationView[],
  traceTimestamp: string,
): MonitorTraceObservationFlat[] {
  const drafts: FlatObservationDraft[] = [];
  flattenObservationTree(observations, null, drafts);
  return assignSyntheticTimestamps(drafts, traceTimestamp);
}

export function buildObservationMetadata(observation: MonitorObservationView): Record<string, unknown> {
  return {
    id: observation.id,
    name: observation.name,
    kind: observation.kind,
    level: observation.level,
    latencyMs: observation.latencyMs ?? null,
    model: observation.model ?? null,
    tokens: observation.tokens ?? null,
    inputTokens: observation.inputTokens ?? null,
    outputTokens: observation.outputTokens ?? null,
    inputTruncated: observation.inputTruncated ?? false,
    outputTruncated: observation.outputTruncated ?? false,
    scoreValue: observation.scoreValue ?? null,
    scoreDataType: observation.scoreDataType ?? null,
  };
}

export function observationIoInput(observation: MonitorObservationView): unknown {
  if (!observation.inputPreview) return null;
  return parseMaybeString(observation.inputPreview);
}

export function observationIoOutput(observation: MonitorObservationView): unknown {
  if (observation.outputPreview) return parseMaybeString(observation.outputPreview);
  if (observation.scoreValue) {
    return {
      value: observation.scoreValue,
      dataType: observation.scoreDataType ?? null,
    };
  }
  return null;
}

function parseTimelineLevel(
  level: string | null | undefined,
): MonitorTimelineSegment['level'] {
  switch (level?.toUpperCase()) {
    case 'ERROR':
      return 'ERROR';
    case 'WARNING':
      return 'WARNING';
    case 'DEBUG':
      return 'DEBUG';
    default:
      return 'DEFAULT';
  }
}

/** 将扁平 observation 时间戳转为 MonitorTimelineShell 相对毫秒段。 */
export function buildMonitorTimelineSegments(
  observations: MonitorTraceObservationFlat[],
): MonitorTimelineSegment[] {
  if (observations.length === 0) return [];

  const parsedStarts = observations
    .map((observation) => Date.parse(observation.startTime))
    .filter((value) => Number.isFinite(value));
  if (parsedStarts.length === 0) return [];

  const baseMs = Math.min(...parsedStarts);

  return observations.flatMap((observation) => {
    const start = Date.parse(observation.startTime);
    const end = observation.endTime ? Date.parse(observation.endTime) : Number.NaN;
    if (!Number.isFinite(start)) return [];

    const startMs = Math.max(0, start - baseMs);
    const endMs = Number.isFinite(end) ? Math.max(startMs, end - baseMs) : startMs;
    const tokens = observation.totalTokens
      ?? (observation.inputTokens !== undefined && observation.outputTokens !== undefined
        ? observation.inputTokens + observation.outputTokens
        : undefined);

    return [{
      id: observation.id,
      name: observation.name ?? 'Untitled',
      kind: observation.type,
      level: parseTimelineLevel(observation.level),
      startMs,
      endMs,
      tokens,
    }];
  });
}
