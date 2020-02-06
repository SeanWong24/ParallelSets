import { compareStrings } from "./utilities/string-comparison.js";

declare type DataRecord = { [dimensionName: string]: string | number };

class ParallelSetsDataNode {
    depth: number;
    childMap: Map<string, ParallelSetsDataNode>;
    dataRecordList: DataRecord[];

    get dataRecordCount() {
        return this.dataRecordList.length;
    }

    constructor(
        public parentNode: ParallelSetsDataNode | undefined,
        public dimensionName: string | undefined,
        public valueName: string | undefined,
        dataRecordList?: DataRecord[]
    ) {
        this.childMap = new Map();
        this.dataRecordList = dataRecordList || [];
        this.depth = +(parentNode?.depth.toString() || -1) + 1;
    }

    initialize(dimensionNameList: string[]) {
        const CURRENT_DIMENSION_NAME = dimensionNameList[0];
        if (CURRENT_DIMENSION_NAME) {
            this.dataRecordList.forEach(dataRecord => {
                const CURRENT_VALUE = dataRecord[CURRENT_DIMENSION_NAME].toString();
                const TARGET_NODE = this.childMap.get(CURRENT_VALUE);
                if (TARGET_NODE) {
                    TARGET_NODE.addDataRecord(dataRecord);
                } else {
                    this.childMap.set(CURRENT_VALUE, new ParallelSetsDataNode(this, CURRENT_DIMENSION_NAME, CURRENT_VALUE).addDataRecord(dataRecord));
                }
            });
            this.childMap = new Map([...this.childMap.entries()].sort((a, b) => compareStrings(a[0], b[0])));

            const TARGET_MAP_VALUE_LIST = Array.from(this.childMap.values());
            TARGET_MAP_VALUE_LIST.forEach(childNode => {
                childNode.initialize(dimensionNameList.slice(1));
            });
        }

        return this;
    }

    addDataRecord(dataRecord: DataRecord) {
        this.dataRecordList.push(dataRecord);
        return this;
    }

    dfs(handler: (node: ParallelSetsDataNode) => void) {
        const STACK = [];
        const EXPLORED_SET = new Set();
        STACK.push(this);

        EXPLORED_SET.add(this);

        while (STACK.length > 0) {
            const CURRENT_NODE = STACK.pop();
            if (CURRENT_NODE) {
                handler(CURRENT_NODE);
            }

            const CHILD_NODE_LIST = [...CURRENT_NODE?.childMap.values() || []];
            CHILD_NODE_LIST.filter(node => !EXPLORED_SET.has(node))
                .forEach(node => {
                    STACK.push(node);
                    EXPLORED_SET.add(node);
                });
        }
    }

    compare(anotherNode: ParallelSetsDataNode | undefined): number {
        if (this.depth === anotherNode?.depth) {
            const VALUE_HISTORY_THIS = [];
            const VALUE_HISTORY_ANOTHER = [];

            let walker = this as ParallelSetsDataNode | undefined;
            while (walker) {
                VALUE_HISTORY_THIS.push(walker.valueName);
                walker = walker.parentNode;
            }
            walker = anotherNode;
            while (walker) {
                VALUE_HISTORY_ANOTHER.push(walker.valueName);
                walker = walker.parentNode;
            }

            let valueComparingResult = compareStrings(VALUE_HISTORY_THIS.shift() || '', VALUE_HISTORY_ANOTHER.shift() || '');
            if (valueComparingResult !== 0) {
                return valueComparingResult;
            }

            while (VALUE_HISTORY_THIS.length > 0) {
                valueComparingResult = compareStrings(VALUE_HISTORY_THIS.pop() || '', VALUE_HISTORY_ANOTHER.pop() || '');
                if (valueComparingResult !== 0) {
                    return valueComparingResult;
                }
            }
            return 0;
        } else {
            return Number.NaN;
        }
    }
}

export class ParallelSets extends HTMLElement {
    private static get template() {
        const TEMPLATE = document.createElement('template');
        TEMPLATE.innerHTML = `
            <svg id="main-svg" width="100%" height="100%">
                <g id="axes"></g>
                <g id="ribbons"></g>
            </svg>
        `;
        return TEMPLATE;
    }

    static get observedAttributes() {
        return [
            'obtainAxisSegmentTooltipHandler'
        ].map(attributeName => attributeName.toLowerCase());
    }

    private get mainSvgElement() {
        return this.shadowRoot?.querySelector('#main-svg') as HTMLElement;
    }

    //#region attributes to properties

    obtainAxisSegmentTooltipHandler: ((dimensionName: string, valueName: string, valueCount: number, totalCount: number) => string)
        = (dimensionName, valueName, valueCount, totalCount) => valueName + '\n' + valueCount + '\n' + (valueCount / totalCount * 100).toFixed(2) + '%';

    //#endregion

    private _data: DataRecord[] = [];
    get data() {
        return this._data;
    }
    set data(value) {
        this._data = value;
        this.render();
    }

    private _dimensions: string[] = [];
    get dimensions() {
        return this._dimensions;
    }
    set dimensions(value) {
        this._dimensions = value;
        this.render();
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot?.appendChild(ParallelSets.template.content.cloneNode(true));
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback(name: string, oldValue: any, newValue: any) {
        if (oldValue !== newValue) {
            switch (name) {
                case 'obtainAxisSegmentTooltipHandler'.toLowerCase():
                    this.obtainAxisSegmentTooltipHandler = eval(newValue);
                    break;
            }
        }
    }

    render() {
        const DIMENSION_NAME_LIST: string[] = (this.dimensions && this.dimensions.length > 0) ? this.dimensions : Object.keys(this.data[0] || {});
        const ROOT_NODE = new ParallelSetsDataNode(undefined, undefined, undefined, this.data).initialize(DIMENSION_NAME_LIST);

        const DEPTH_NODE_LIST_MAP = new Map<number, ParallelSetsDataNode[]>();
        ROOT_NODE.dfs(node => {
            const NODE_LIST = DEPTH_NODE_LIST_MAP.get(node.depth);

            if (NODE_LIST) {
                NODE_LIST.push(node);
            } else {
                DEPTH_NODE_LIST_MAP.set(node.depth, [node]);
            }
        });

        DEPTH_NODE_LIST_MAP.forEach(value => value.sort((a, b) => a.compare(b)));

        const TOTAL_RECORD_COUNT = this.data.length;
        this.renderAxes(DEPTH_NODE_LIST_MAP, TOTAL_RECORD_COUNT, DIMENSION_NAME_LIST);
        this.renderRibbons(DEPTH_NODE_LIST_MAP, TOTAL_RECORD_COUNT, DIMENSION_NAME_LIST);
    }

    private renderRibbons(depthNodeListMap: Map<number, ParallelSetsDataNode[]>, totalRecordCount: number, dimensionNameList: string[]) {
        const RIBBON_G = this.clearContainer('#ribbons');

        const COLOR_SCALE = d3.scaleOrdinal(d3.schemeAccent);
        const POSITION_SCALE = d3.scaleLinear()
            .domain([0, this.data.length])
            .range([10, this.mainSvgElement.clientHeight - 10]);

        depthNodeListMap.forEach((nodeList, depth) => {
            if (depth > 1) {
                const CURRENT_LAYER_RIBBON_G = RIBBON_G
                    .append('g')
                    .attr('id', 'ribbon-layer-' + depth)
                    .classed('ribbon-layer', true);

                const CURRENT_LAYER_RIBBON_PATHES = CURRENT_LAYER_RIBBON_G
                    .selectAll('path')
                    .data(nodeList)
                    .enter()
                    .append('path')
                    .attr('d', (node, index) => {
                        const CANVAS_WIDTH = this.mainSvgElement.clientWidth;
                        const DIMENSION_SPLIT_COUNT = dimensionNameList.length - 1;
                        const PARENT_DEPTH = depth - 1;
                        const PARENT_INDEX = (depthNodeListMap.get(PARENT_DEPTH) || []).findIndex(d => d === node.parentNode);
                        const CURRENT_INDEX_IN_PARENT_CHILD_MAP = [...node.parentNode?.childMap.entries() || []].findIndex(d => d[1] === node);

                        const PREVIOUS_LAYER_NODE_LIST = depthNodeListMap.get(PARENT_DEPTH);
                        const PREVIOUS_LAYER_NODE_LIST_BEFORE_PARENT_NODE = PREVIOUS_LAYER_NODE_LIST?.slice(0, PARENT_INDEX);
                        const PREVIOUS_LAYER_NODE_RECORD_COUNT_BEFORE_PARENT_NODE = d3.sum(PREVIOUS_LAYER_NODE_LIST_BEFORE_PARENT_NODE?.map(node => node.dataRecordCount) || [0]);

                        const PARENT_NODE_CHILD_MAP_ENTRY_LIST = [...node.parentNode?.childMap.entries() || []];
                        const SIBLING_LIST_BEFORE_CURRENT_NODE = PARENT_NODE_CHILD_MAP_ENTRY_LIST.slice(0, CURRENT_INDEX_IN_PARENT_CHILD_MAP);
                        const SIBLING_RECORD_COUNT_BEFORE_CURRENT_NODE = d3.sum(SIBLING_LIST_BEFORE_CURRENT_NODE.map(d => d[1].dataRecordCount));

                        const CURRENT_LAYER_NODE_LIST = depthNodeListMap.get(depth);
                        const CURRENT_LAYER_NODE_LIST_BEFORE_CURRENT_NODE = CURRENT_LAYER_NODE_LIST?.slice(0, index);
                        const CUUREN_LAYER_NODE_RECORD_COUNT_BEFORE_CURRENT_NODE = d3.sum(CURRENT_LAYER_NODE_LIST_BEFORE_CURRENT_NODE?.map(d => d.dataRecordCount) || [0]);

                        const CURRENT_LAYER_NODE_LIST_TILL_CURRENT_NODE = CURRENT_LAYER_NODE_LIST?.slice(0, index + 1);
                        const CUUREN_LAYER_NODE_RECORD_COUNT_TILL_CURRENT_NODE = d3.sum(CURRENT_LAYER_NODE_LIST_TILL_CURRENT_NODE?.map(d => d.dataRecordCount) || [0]);

                        const X1 = CANVAS_WIDTH / DIMENSION_SPLIT_COUNT * (PARENT_DEPTH - 1);
                        const Y1 = POSITION_SCALE(
                            PREVIOUS_LAYER_NODE_RECORD_COUNT_BEFORE_PARENT_NODE +
                            SIBLING_RECORD_COUNT_BEFORE_CURRENT_NODE
                        );
                        const X2 = CANVAS_WIDTH / DIMENSION_SPLIT_COUNT * (depth - 1);
                        const Y2 = POSITION_SCALE(CUUREN_LAYER_NODE_RECORD_COUNT_BEFORE_CURRENT_NODE);
                        const X3 = X2;
                        const Y3 = POSITION_SCALE(CUUREN_LAYER_NODE_RECORD_COUNT_TILL_CURRENT_NODE);
                        const X4 = X1;
                        const Y4 = Y1 + Y3 - Y2;
                        return `M ${X1} ${Y1} L ${X2} ${Y2} L ${X3} ${Y3} L ${X4} ${Y4} Z`;
                    })
                    .attr('stroke', 'black')
                    .attr('stroke-width', 1)
                    .attr('fill', node => {
                        let walker = node;
                        while (walker.parentNode?.parentNode) {
                            walker = walker.parentNode;
                        }
                        return COLOR_SCALE(walker.valueName || '');
                    })
                    .attr('opacity', .5)
                    .attr('cursor', 'pointer')
                    .on('mouseover', node => {
                        const NODE_HIERARCHY_LIST = [node];
                        let walker = node;
                        while (walker.parentNode) {
                            walker = walker.parentNode;
                            NODE_HIERARCHY_LIST.unshift(walker);
                        }
                        RIBBON_G.selectAll('path')
                            .filter(n => (NODE_HIERARCHY_LIST.find(d => d === n) as unknown as boolean))
                            .attr('opacity', .9);
                    })
                    .on('mouseout', () => {
                        RIBBON_G.selectAll('path')
                            .attr('opacity', .5);
                    });
                CURRENT_LAYER_RIBBON_PATHES.append('title')
                    .text(node => node.parentNode?.valueName + '=>' + node.valueName + ',' + node.dataRecordCount);
            }
        })
    }

    private renderAxes(depthNodeListMap: Map<number, ParallelSetsDataNode[]>, totalRecordCount: number, dimensionNameList: string[]) {
        const AXES_G = this.clearContainer('#axes');
    }

    private clearContainer(selectorString: string, rootElement: HTMLElement = this.mainSvgElement) {
        const CONTAINER = d3.select(rootElement).select(selectorString);
        CONTAINER.selectAll('*').remove();
        return CONTAINER;
    }
}

customElements.define('parallel-sets', ParallelSets);