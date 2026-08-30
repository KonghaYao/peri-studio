/** Git Graph 布局常量（对齐 vscode-git-graph / src/config.ts）。 */
export const GIT_GRAPH_COLORS = [
  '#0085d9',
  '#d9008f',
  '#00d90a',
  '#d98500',
  '#a300d9',
  '#ff0000',
  '#00d9cc',
  '#e138e8',
  '#85d900',
  '#dc5b23',
  '#6f24d6',
  '#ff0000',
] as const;

export const GIT_GRAPH_GRID = {
  x: 16,
  y: 24,
  offsetX: 16,
  offsetY: 12,
  expandY: 250,
} as const;

export const GIT_GRAPH_HEADER_HEIGHT = 31;
export const GIT_GRAPH_ROW_HEIGHT = 24;

export enum GitGraphStyle {
  Rounded = 0,
  Angular = 1,
}

export type GitGraphLayoutCommit = {
  hash: string;
  parents: string[];
  stash?: null;
};

export type GitGraphPathSegment = {
  d: string;
  color: string;
  isCommitted: boolean;
  shadowColor: string;
};

export type GitGraphNode = {
  index: number;
  cx: number;
  cy: number;
  color: string;
  colorIndex: number;
  isCurrent: boolean;
  isStash: boolean;
};

export type GitGraphLayout = {
  contentWidth: number;
  height: number;
  paths: GitGraphPathSegment[];
  nodes: GitGraphNode[];
  vertexColors: number[];
};

interface Point {
  x: number;
  y: number;
}

interface Line {
  p1: Point;
  p2: Point;
  lockedFirst: boolean;
}

interface Pixel {
  x: number;
  y: number;
}

interface PlacedLine {
  p1: Pixel;
  p2: Pixel;
  isCommitted: boolean;
  lockedFirst: boolean;
}

interface UnavailablePoint {
  connectsTo: Vertex | null;
  onBranch: Branch;
}

const NULL_VERTEX_ID = -1;

class Branch {
  private lines: Line[] = [];
  private numUncommitted = 0;

  constructor(private readonly colour: number) {}

  addLine(p1: Point, p2: Point, isCommitted: boolean, lockedFirst: boolean) {
    this.lines.push({ p1, p2, lockedFirst });
    if (isCommitted) {
      if (p2.x === 0 && p2.y < this.numUncommitted) this.numUncommitted = p2.y;
    } else {
      this.numUncommitted += 1;
    }
  }

  getColour() {
    return this.colour;
  }

  buildPaths(
    grid: { x: number; y: number; offsetX: number; offsetY: number; expandY: number },
    style: GitGraphStyle,
    expandAt: number,
    colors: readonly string[],
    bgColor: string,
  ): GitGraphPathSegment[] {
    const colour = colors[this.colour % colors.length];
    const dFactor = grid.y * (style === GitGraphStyle.Angular ? 0.38 : 0.8);
    const lines: PlacedLine[] = [];

    for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex += 1) {
      const line = this.lines[lineIndex];
      let x1 = line.p1.x * grid.x + grid.offsetX;
      let y1 = line.p1.y * grid.y + grid.offsetY;
      let x2 = line.p2.x * grid.x + grid.offsetX;
      let y2 = line.p2.y * grid.y + grid.offsetY;

      if (expandAt > -1) {
        if (line.p1.y > expandAt) {
          y1 += grid.expandY;
          y2 += grid.expandY;
        } else if (line.p2.y > expandAt) {
          if (x1 === x2) {
            y2 += grid.expandY;
          } else if (line.lockedFirst) {
            lines.push({ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, isCommitted: true, lockedFirst: line.lockedFirst });
            lines.push({
              p1: { x: x2, y: y1 + grid.y },
              p2: { x: x2, y: y2 + grid.expandY },
              isCommitted: true,
              lockedFirst: line.lockedFirst,
            });
            continue;
          } else {
            lines.push({
              p1: { x: x1, y: y1 },
              p2: { x: x1, y: y2 - grid.y + grid.expandY },
              isCommitted: true,
              lockedFirst: line.lockedFirst,
            });
            y1 += grid.expandY;
            y2 += grid.expandY;
          }
        }
      }

      lines.push({
        p1: { x: x1, y: y1 },
        p2: { x: x2, y: y2 },
        isCommitted: lineIndex >= this.numUncommitted,
        lockedFirst: line.lockedFirst,
      });
    }

    let i = 0;
    while (i < lines.length - 1) {
      const line = lines[i];
      const next = lines[i + 1];
      if (
        line.p1.x === line.p2.x
        && line.p2.x === next.p1.x
        && next.p1.x === next.p2.x
        && line.p2.y === next.p1.y
        && line.isCommitted === next.isCommitted
      ) {
        line.p2.y = next.p2.y;
        lines.splice(i + 1, 1);
      } else {
        i += 1;
      }
    }

    const segments: GitGraphPathSegment[] = [];
    let curPath = '';

    for (i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const x1 = line.p1.x;
      const y1 = line.p1.y;
      const x2 = line.p2.x;
      const y2 = line.p2.y;

      if (curPath !== '' && i > 0 && line.isCommitted !== lines[i - 1].isCommitted) {
        segments.push({
          d: curPath,
          color: lines[i - 1].isCommitted ? colour : '#808080',
          isCommitted: lines[i - 1].isCommitted,
          shadowColor: bgColor,
        });
        curPath = '';
      }

      if (curPath === '' || (i > 0 && (x1 !== lines[i - 1].p2.x || y1 !== lines[i - 1].p2.y))) {
        curPath += `M${x1.toFixed(0)},${y1.toFixed(1)}`;
      }

      if (x1 === x2) {
        curPath += `L${x2.toFixed(0)},${y2.toFixed(1)}`;
      } else if (style === GitGraphStyle.Angular) {
        curPath += `L${line.lockedFirst ? `${x2.toFixed(0)},${(y2 - dFactor).toFixed(1)}` : `${x1.toFixed(0)},${(y1 + dFactor).toFixed(1)}`}L${x2.toFixed(0)},${y2.toFixed(1)}`;
      } else {
        curPath += `C${x1.toFixed(0)},${(y1 + dFactor).toFixed(1)} ${x2.toFixed(0)},${(y2 - dFactor).toFixed(1)} ${x2.toFixed(0)},${y2.toFixed(1)}`;
      }
    }

    if (curPath !== '') {
      segments.push({
        d: curPath,
        color: lines[lines.length - 1].isCommitted ? colour : '#808080',
        isCommitted: lines[lines.length - 1].isCommitted,
        shadowColor: bgColor,
      });
    }

    return segments;
  }
}

class Vertex {
  private x = 0;
  private children: Vertex[] = [];
  private parents: Vertex[] = [];
  private nextParent = 0;
  private onBranch: Branch | null = null;
  private isCommitted = true;
  private isCurrent = false;
  private nextX = 0;
  private connections: UnavailablePoint[] = [];

  constructor(
    public readonly id: number,
    public readonly isStash: boolean,
  ) {}

  addChild(vertex: Vertex) {
    this.children.push(vertex);
  }

  addParent(vertex: Vertex) {
    this.parents.push(vertex);
  }

  getParents() {
    return this.parents;
  }

  getNextParent(): Vertex | null {
    if (this.nextParent < this.parents.length) return this.parents[this.nextParent];
    return null;
  }

  registerParentProcessed() {
    this.nextParent += 1;
  }

  isMerge() {
    return this.parents.length > 1;
  }

  addToBranch(branch: Branch, x: number) {
    if (this.onBranch === null) {
      this.onBranch = branch;
      this.x = x;
    }
  }

  isNotOnBranch() {
    return this.onBranch === null;
  }

  isOnThisBranch(branch: Branch) {
    return this.onBranch === branch;
  }

  getBranch() {
    return this.onBranch;
  }

  getPoint(): Point {
    return { x: this.x, y: this.id };
  }

  getNextPoint(): Point {
    return { x: this.nextX, y: this.id };
  }

  getPointConnectingTo(vertex: Vertex | null, onBranch: Branch): Point | null {
    for (let i = 0; i < this.connections.length; i += 1) {
      if (this.connections[i].connectsTo === vertex && this.connections[i].onBranch === onBranch) {
        return { x: i, y: this.id };
      }
    }
    return null;
  }

  registerUnavailablePoint(x: number, connectsToVertex: Vertex | null, onBranch: Branch) {
    if (x === this.nextX) {
      this.nextX = x + 1;
      this.connections[x] = { connectsTo: connectsToVertex, onBranch };
    }
  }

  getColour() {
    return this.onBranch !== null ? this.onBranch.getColour() : 0;
  }

  getIsCommitted() {
    return this.isCommitted;
  }

  setCurrent() {
    this.isCurrent = true;
  }

  getIsCurrent() {
    return this.isCurrent;
  }
}

class GraphModel {
  private vertices: Vertex[] = [];
  private branches: Branch[] = [];
  private availableColours: number[] = [];
  private grid: {
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    expandY: number;
  } = { ...GIT_GRAPH_GRID };

  loadCommits(
    commits: GitGraphLayoutCommit[],
    commitHead: string | null,
    commitLookup: Record<string, number>,
  ) {
    this.vertices = [];
    this.branches = [];
    this.availableColours = [];

    if (commits.length === 0) return;

    const nullVertex = new Vertex(NULL_VERTEX_ID, false);

    for (let i = 0; i < commits.length; i += 1) {
      this.vertices.push(new Vertex(i, commits[i].stash !== null));
    }

    for (let i = 0; i < commits.length; i += 1) {
      for (let j = 0; j < commits[i].parents.length; j += 1) {
        const parentHash = commits[i].parents[j];
        const parentIndex = commitLookup[parentHash];
        if (typeof parentIndex === 'number') {
          this.vertices[i].addParent(this.vertices[parentIndex]);
          this.vertices[parentIndex].addChild(this.vertices[i]);
        } else {
          this.vertices[i].addParent(nullVertex);
        }
      }
    }

    if (commitHead !== null && typeof commitLookup[commitHead] === 'number') {
      this.vertices[commitLookup[commitHead]].setCurrent();
    }

    let i = 0;
    while (i < this.vertices.length) {
      if (this.vertices[i].getNextParent() !== null || this.vertices[i].isNotOnBranch()) {
        this.determinePath(i);
      } else {
        i += 1;
      }
    }
  }

  layout(
    headerHeight: number,
    rowHeight: number,
    style: GitGraphStyle,
    colors: readonly string[],
    bgColor: string,
  ): GitGraphLayout {
    this.grid.y = rowHeight;
    this.grid.offsetY = headerHeight + rowHeight / 2;

    const contentWidth = this.getContentWidth();
    const height = this.vertices.length * rowHeight + headerHeight;
    const paths: GitGraphPathSegment[] = [];

    for (const branch of this.branches) {
      paths.push(...branch.buildPaths(this.grid, style, -1, colors, bgColor));
    }

    const nodes: GitGraphNode[] = [];
    const vertexColors: number[] = [];

    for (let i = 0; i < this.vertices.length; i += 1) {
      const vertex = this.vertices[i];
      if (vertex.isNotOnBranch()) {
        vertexColors[i] = 0;
        continue;
      }

      const colorIndex = vertex.getColour() % colors.length;
      const color = colors[colorIndex];
      const cx = vertex.getPoint().x * this.grid.x + this.grid.offsetX;
      const cy = i * this.grid.y + this.grid.offsetY;

      nodes.push({
        index: i,
        cx,
        cy,
        color,
        colorIndex,
        isCurrent: vertex.getIsCurrent(),
        isStash: vertex.isStash,
      });
      vertexColors[i] = colorIndex;
    }

    return { contentWidth, height, paths, nodes, vertexColors };
  }

  private getContentWidth() {
    let maxX = 0;
    for (const vertex of this.vertices) {
      const p = vertex.getNextPoint();
      if (p.x > maxX) maxX = p.x;
    }
    return 2 * this.grid.offsetX + (maxX - 1) * this.grid.x;
  }

  private determinePath(startAt: number) {
    let i = startAt;
    let vertex = this.vertices[i];
    let parentVertex = vertex.getNextParent();
    let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();

    if (
      parentVertex !== null
      && parentVertex.id !== NULL_VERTEX_ID
      && vertex.isMerge()
      && !vertex.isNotOnBranch()
      && !parentVertex.isNotOnBranch()
    ) {
      const parentBranch = parentVertex.getBranch()!;
      let foundPointToParent = false;

      for (i = startAt + 1; i < this.vertices.length; i += 1) {
        const curVertex = this.vertices[i];
        let curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
        if (curPoint !== null) {
          foundPointToParent = true;
        } else {
          curPoint = curVertex.getNextPoint();
        }

        parentBranch.addLine(lastPoint, curPoint, vertex.getIsCommitted(), !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
        lastPoint = curPoint;

        if (foundPointToParent) {
          vertex.registerParentProcessed();
          break;
        }
      }
    } else {
      const branch = new Branch(this.getAvailableColour(startAt));
      vertex.addToBranch(branch, lastPoint.x);
      vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);

      for (i = startAt + 1; i < this.vertices.length; i += 1) {
        const curVertex = this.vertices[i];
        const curPoint = parentVertex === curVertex && !parentVertex.isNotOnBranch()
          ? curVertex.getPoint()
          : curVertex.getNextPoint();

        branch.addLine(lastPoint, curPoint, vertex.getIsCommitted(), lastPoint.x < curPoint.x);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
        lastPoint = curPoint;

        if (parentVertex === curVertex) {
          vertex.registerParentProcessed();
          const parentOnBranch = !parentVertex.isNotOnBranch();
          parentVertex.addToBranch(branch, curPoint.x);
          vertex = parentVertex;
          parentVertex = vertex.getNextParent();
          if (parentVertex === null || parentOnBranch) break;
        }
      }

      if (i === this.vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
        vertex.registerParentProcessed();
      }

      this.branches.push(branch);
      this.availableColours[branch.getColour()] = i;
    }
  }

  private getAvailableColour(startAt: number) {
    for (let i = 0; i < this.availableColours.length; i += 1) {
      if (startAt > this.availableColours[i]) return i;
    }
    this.availableColours.push(0);
    return this.availableColours.length - 1;
  }
}

export function layoutGitGraph(
  commits: GitGraphLayoutCommit[],
  headHash: string | null,
  options?: {
    style?: GitGraphStyle;
    colors?: readonly string[];
    bgColor?: string;
    headerHeight?: number;
    rowHeight?: number;
  },
): GitGraphLayout {
  const commitLookup: Record<string, number> = {};
  commits.forEach((commit, index) => {
    commitLookup[commit.hash] = index;
  });

  const model = new GraphModel();
  model.loadCommits(commits, headHash, commitLookup);

  return model.layout(
    options?.headerHeight ?? GIT_GRAPH_HEADER_HEIGHT,
    options?.rowHeight ?? GIT_GRAPH_ROW_HEIGHT,
    options?.style ?? GitGraphStyle.Rounded,
    options?.colors ?? GIT_GRAPH_COLORS,
    options?.bgColor ?? 'var(--surface-overlay)',
  );
}
