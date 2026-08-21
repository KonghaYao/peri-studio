//! 聚合器控制侧写入测试（对应 `aggregator_write_control.rs` 的 agent
//! map）：AgentConfig 部分更新语义（None 不覆盖）、AgentUsage 快照
//! 覆写、CommandCatalog 描述投影与 negotiated local skill 能力门控
//! （跨任务契约 §1 / §8.5）。

use super::util::*;

use yrs::{Array, Map, Transact, WriteTxn};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::factory::ROOT;
use crate::state::normalized::EventBody;

// ---------------------------------------------------------------------------
// 17. AgentConfig/AgentUsage → Control Doc agent map（跨任务契约 §1）
// ---------------------------------------------------------------------------

#[test]
fn agent_config_partial_update_none_keeps_existing() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 首轮写入 model/effort。
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                1,
                EventBody::AgentConfig {
                    model: Some("claude-sonnet-4-5".into()),
                    effort: Some("high".into()),
                    config_options: None,
                }
            )
        )
        .applied
    );
    // 部分更新：model 为 None 不覆盖既有值，effort 更新。
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                2,
                EventBody::AgentConfig {
                    model: None,
                    effort: Some("low".into()),
                    config_options: None,
                }
            )
        )
        .applied
    );
    let txn = p.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        agent.get(&txn, "model").unwrap().cast::<String>().unwrap(),
        "claude-sonnet-4-5",
        "None 不覆盖 model"
    );
    assert_eq!(
        agent.get(&txn, "effort").unwrap().cast::<String>().unwrap(),
        "low",
        "effort 部分更新"
    );
    let _ = root;
}

#[test]
fn agent_usage_snapshot_overwrites() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 先经 AgentStatus 写模型/用量，再被 usage_update 快照覆盖。
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                1,
                EventBody::AgentStatus {
                    status: "running".into(),
                    public_error: None,
                    model: Some("claude-sonnet-4-5".into()),
                    context_window: Some(200_000),
                    context_used: Some(42_000),
                }
            )
        )
        .applied
    );
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                2,
                EventBody::AgentUsage {
                    context_window: 200_000,
                    context_used: 88_888,
                    input_tokens: Some(1_200),
                    output_tokens: Some(345),
                    cache_creation_tokens: None,
                    cache_read_tokens: Some(900),
                    request_id: Some("req-123".into()),
                    model: Some("claude-opus-4-1".into()),
                    stop_reason: Some("end_turn".into()),
                }
            )
        )
        .applied
    );
    let txn = p.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        agent.get(&txn, "model").unwrap().cast::<String>().unwrap(),
        "claude-sonnet-4-5",
        "usage_update 不动 model"
    );
    let latest = agent
        .get(&txn, "latest_usage")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        latest
            .get(&txn, "input_tokens")
            .unwrap()
            .cast::<u32>()
            .unwrap(),
        1_200
    );
    assert_eq!(
        latest
            .get(&txn, "cache_read_tokens")
            .unwrap()
            .cast::<u32>()
            .unwrap(),
        900
    );
    assert_eq!(
        latest
            .get(&txn, "stop_reason")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "end_turn"
    );
    assert_eq!(
        agent
            .get(&txn, "context_window")
            .unwrap()
            .cast::<u32>()
            .unwrap(),
        200_000
    );
    assert_eq!(
        agent
            .get(&txn, "context_used")
            .unwrap()
            .cast::<u32>()
            .unwrap(),
        88_888,
        "usage_update 全量覆盖 context_used"
    );
    let _ = root;
}

#[test]
fn command_catalog_projects_descriptions_and_requires_negotiated_local_skill_cap() {
    fn project(with_extension: bool) -> DocPair {
        let mut pair = pair();
        if with_extension {
            let mut txn = pair.session.transact_mut();
            let root = txn.get_or_insert_map(ROOT);
            let agent = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
            let extensions = agent.get_or_init::<_, yrs::ArrayRef>(&mut txn, "extensions");
            extensions.push_back(&mut txn, "peri.skillNames");
        }
        let descriptions = std::collections::BTreeMap::from([
            ("compact".to_string(), "Compress context".to_string()),
            ("auto-fix".to_string(), "Fix an issue".to_string()),
            ("mcp__docs__search".to_string(), "Search docs".to_string()),
        ]);
        assert!(
            Aggregator
                .apply(
                    &mut pair,
                    &ev(
                        "s1",
                        1,
                        EventBody::Capabilities {
                            capabilities: vec![
                                "compact".into(),
                                "auto-fix".into(),
                                "mcp__docs__search".into(),
                            ],
                            descriptions,
                            skill_names: vec!["auto-fix".into()],
                            mcp_skill_names: vec!["mcp__docs__search".into()],
                        },
                    ),
                )
                .applied
        );
        pair
    }

    let mut negotiated = project(true);
    let txn = negotiated.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let names = agent
        .get(&txn, "available_commands")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    assert_eq!(names.get(&txn, 1), Some("auto-fix".into()));
    let catalog = agent
        .get(&txn, "command_catalog")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let local = catalog
        .get(&txn, "auto-fix")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(local.get(&txn, "kind"), Some("skill".into()));
    assert_eq!(local.get(&txn, "description"), Some("Fix an issue".into()));
    let mcp = catalog
        .get(&txn, "mcp__docs__search")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(mcp.get(&txn, "kind"), Some("mcp_skill".into()));
    drop(txn);

    assert!(
        Aggregator
            .apply(
                &mut negotiated,
                &ev(
                    "s1",
                    2,
                    EventBody::Capabilities {
                        capabilities: vec!["compact".into()],
                        descriptions: std::collections::BTreeMap::new(),
                        skill_names: Vec::new(),
                        mcp_skill_names: Vec::new(),
                    },
                ),
            )
            .applied
    );
    let txn = negotiated.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let catalog = agent
        .get(&txn, "command_catalog")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert!(catalog.get(&txn, "auto-fix").is_none());
    assert!(catalog.get(&txn, "mcp__docs__search").is_none());
    drop(txn);

    let unnegotiated = project(false);
    let txn = unnegotiated.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let catalog = agent
        .get(&txn, "command_catalog")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let local = catalog
        .get(&txn, "auto-fix")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(local.get(&txn, "kind"), Some("command".into()));
}
