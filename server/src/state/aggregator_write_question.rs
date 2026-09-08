//! 聚合器 AskUserQuestion 投影写辅助（WP-B）。

use peri_studio_proto::schema::QuestionItemProjection;

use crate::state::question;
use crate::state::view_store::TransactionCtx;

/// 防御性过滤（对齐 Fenix `extractQuestionItems`）：normalize 已校验，聚合层再滤一遍。
pub(crate) fn filter_question_items(items: &[QuestionItemProjection]) -> Vec<QuestionItemProjection> {
    items
        .iter()
        .filter(|item| !item.question.is_empty())
        .map(|item| QuestionItemProjection {
            question: item.question.clone(),
            header: item
                .header
                .as_ref()
                .filter(|h| !h.is_empty())
                .cloned(),
            options: item
                .options
                .iter()
                .filter(|o| !o.label.is_empty())
                .cloned()
                .collect(),
            multi_select: item.multi_select,
        })
        .collect()
}

pub(crate) fn write_question_requested(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    question_id: &str,
    questions: &[QuestionItemProjection],
    description: Option<&str>,
    expires_at: &str,
) {
    let filtered = filter_question_items(questions);
    if filtered.is_empty() {
        return;
    }
    question::upsert_pending(txn, root, question_id, &filtered, description, expires_at);
}
