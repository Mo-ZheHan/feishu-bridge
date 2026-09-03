'use strict';

// ccc back：某会话最后一段助手输出 → 绿色「Claude 完成」卡，供飞书回顾；空会话返 null（调用方改发报错卡）。

const path = require('path');
const { forEachTail, getAssistantText } = require('./transcript-utils');
const { readOfficialStats } = require('./session-stats');
const { card2, statsTags, statsSubtitle } = require('./card');
const { parseMarkdownToElements } = require('./feishu-card-utils');

/** 最近一条有文本的助手消息（= 会话最后说的话，不论当前是否在干活）；空则 '' */
function latestAssistantText(transcriptPath) {
    let result = '';
    forEachTail(transcriptPath, (d) => {
        if (d.type !== 'assistant') return false;
        const t = getAssistantText(d);
        if (t) { result = t; return true; }
        return false;
    });
    return result;
}

/** 重建该会话最新「Claude 完成」卡；空会话（无 transcript 或无助手输出）返 null。
 *  statsDir：该会话统计文件所在目录（容器会话由 hook 登记），缺省 /tmp */
function buildCompletionCard(transcriptPath, statsDir) {
    if (!transcriptPath) return null;
    const body = latestAssistantText(transcriptPath);
    if (!body) return null;
    const stats = readOfficialStats(path.basename(transcriptPath, '.jsonl'), statsDir || undefined);
    return card2({
        template: 'green', title: 'Claude 完成', subtitle: statsSubtitle(stats),
        tags: statsTags(stats), elements: parseMarkdownToElements(body),
    });
}

module.exports = { latestAssistantText, buildCompletionCard };
