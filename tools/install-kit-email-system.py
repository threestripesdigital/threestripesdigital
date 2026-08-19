#!/usr/bin/env python3
"""Stage, verify, and activate the Rank Boost Kit email system.

The installer reuses an already-authenticated Kit tab in Google Chrome. It never
reads or stores cookies, API keys, or CSRF tokens outside that browser tab.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "ops" / "kit-email-system.json"
DEFAULT_STATE = Path.home() / ".aidevops/.agent-workspace/tmp/rankboost-kit-install-state.json"
TARGET_NAMES = {
    "Unbooked": "LP — form, no book",
    "Booked": "Calendly — booked",
    "No Show": "Calendly — no-show",
    "Boost Live": "Boost Live",
}
SEQUENCE_NAMES = ("Unbooked", "Booked", "No Show", "Boost Live")
BANNED_COPY = (
    "guaranteed",
    "guarantee",
    "will get you",
    "google sees",
    "moves you up",
    "will not flag",
    "won't flag",
    "day 3 to 14",
    "on page 1 from",
)


class InstallError(RuntimeError):
    """Raised when a Kit operation cannot be verified."""


def run_osascript(lines: list[str]) -> str:
    command = ["osascript"]
    for line in lines:
        command.extend(["-e", line])
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode:
        raise InstallError(result.stderr.strip() or "AppleScript failed")
    return result.stdout.strip()


def find_kit_tab() -> tuple[int, int]:
    output = run_osascript(
        [
            'tell application "Google Chrome"',
            'set matches to ""',
            'repeat with w from 1 to count of windows',
            'repeat with t from 1 to count of tabs of window w',
            'if URL of tab t of window w contains "app.kit.com" then set matches to matches & w & ":" & t & linefeed',
            "end repeat",
            "end repeat",
            "return matches",
            "end tell",
        ]
    )
    matches = [line for line in output.splitlines() if line]
    if not matches:
        raise InstallError("No authenticated app.kit.com Chrome tab was found")
    window, tab = matches[0].split(":", 1)
    return int(window), int(tab)


def applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def browser_json(window: int, tab: int, javascript: str) -> dict:
    output = run_osascript(
        [
            f'tell application "Google Chrome" to tell tab {tab} of window {window} '
            f"to execute javascript {applescript_string(javascript)}"
        ]
    )
    try:
        value = json.loads(output)
    except json.JSONDecodeError as error:
        raise InstallError(f"Kit returned an invalid response: {output[:200]}") from error
    if not isinstance(value, dict):
        raise InstallError("Kit browser operation did not return an object")
    return value


def operation_script(operation: str, payload: dict) -> str:
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return f"""(()=>{{
const input={encoded};
const csrf=document.querySelector('meta[name=csrf-token]')?.content;
if(!csrf)return JSON.stringify({{ok:false,error:'missing_csrf'}});
const req=(method,url,data)=>{{
  const x=new XMLHttpRequest();
  x.open(method,url,false);
  x.setRequestHeader('Accept','application/json');
  x.setRequestHeader('Content-Type','application/json');
  x.setRequestHeader('X-CSRF-Token',csrf);
  x.send(data===undefined?null:JSON.stringify(data));
  let body=null;
  try{{body=JSON.parse(x.responseText)}}catch{{body=null}}
  return {{ok:x.status>=200&&x.status<300,status:x.status,data:body}};
}};
const course=id=>req('GET','/api/v3/sequences/'+id).data?.course;
const full=id=>req('GET','/email_templates/'+id).data;
try{{
  if('{operation}'==='create_sequence'){{
    const made=req('POST','/sequences',{{course:{{email_layout_template_id:input.layout_id}},editor_enabled:false}});
    const id=made.data?.id||made.data?.course?.id;
    if(!made.ok||!id)return JSON.stringify({{ok:false,step:'create_sequence',status:made.status}});
    const renamed=req('PUT','/api/v3/courses/'+id+'.json',{{course:{{name:input.name}}}});
    return JSON.stringify({{ok:renamed.ok,id,create_status:made.status,rename_status:renamed.status}});
  }}
  if('{operation}'==='stage_email'){{
    const current=course(input.sequence_id);
    const existing=(current?.email_templates||[]).find(e=>e.state==='draft'&&e.subject===input.subject);
    let id=existing?.id;
    if(!id){{
      const made=req('POST','/email_templates',{{sequence_id:input.sequence_id,editor_enabled:false}});
      if(!made.ok||!made.data?.id)return JSON.stringify({{ok:false,step:'create_email',status:made.status}});
      id=made.data.id;
    }}
    let email=full(id);
    if(!email?.document?.id)return JSON.stringify({{ok:false,step:'load_email',id}});
    const schedule=req('PUT','/api/v3/email_templates/'+id+'.json',{{email_template:{{id,send_offset:input.offset_value,offset_units:input.offset_unit,editor_enabled:false}}}});
    if(!schedule.ok)return JSON.stringify({{ok:false,step:'schedule',id,status:schedule.status}});
    const saved=req('POST','/editor/document_versions/'+email.document.id,{{
      document_id:email.document.id,
      previous_version_id:email.document.last_version_id,
      subject:input.subject,
      value:'{{}}',
      value_html:input.html_body,
      version:1
    }});
    if(!saved.ok&&saved.data?.code!=='no_change')return JSON.stringify({{ok:false,step:'save',id,status:saved.status,code:saved.data?.code}});
    email=full(id);
    const version=email?.unpublished_version;
    const verified=email?.send_offset===input.offset_value&&email?.offset_units===input.offset_unit&&version?.subject===input.subject&&version?.value_html===input.html_body;
    return JSON.stringify({{ok:verified,id,document_id:email?.document?.id,version_id:version?.id,step:verified?'staged':'verify_stage'}});
  }}
  if('{operation}'==='publish_email'){{
    const email=full(input.id);
    const documentId=email?.document?.id;
    if(!documentId||!email?.unpublished_version)return JSON.stringify({{ok:false,step:'missing_staged_version',id:input.id}});
    const published=req('POST','/editor/document_versions/'+documentId+'/publish',{{emailable_id:input.id,emailable_type:'email_template',from_automation:false}});
    return JSON.stringify({{ok:published.ok,id:input.id,status:published.status,warnings:published.data?.warnings||[]}});
  }}
  if('{operation}'==='set_draft'){{
    const changed=req('PUT','/api/v3/email_templates/'+input.id+'.json',{{email_template:{{id:input.id,state:'draft'}}}});
    return JSON.stringify({{ok:changed.ok,id:input.id,status:changed.status}});
  }}
  if('{operation}'==='finalize_sequence'){{
    const positions=input.new_ids.map((id,position)=>({{id,position}}));
    const ordered=req('POST','/api/v3/courses/'+input.sequence_id+'/update_positions',{{email_templates:positions}});
    if(!ordered.ok)return JSON.stringify({{ok:false,step:'order',status:ordered.status}});
    if(input.activate_sequence){{
      const activated=req('PUT','/sequences/'+input.sequence_id,{{course:{{state:'available'}}}});
      if(!activated.ok)return JSON.stringify({{ok:false,step:'activate_sequence',status:activated.status}});
    }}
    const archived=[];
    const restoreArchived=()=>{{
      const restored=[];
      for(const id of archived){{
        const result=req('PUT','/api/v3/email_templates/'+id+'.json',{{email_template:{{id,state:'active'}}}});
        restored.push({{id,ok:result.ok,status:result.status}});
      }}
      return restored;
    }};
    for(const id of input.old_ids){{
      const result=req('PUT','/api/v3/email_templates/'+id+'.json',{{email_template:{{id,state:'draft'}}}});
      if(!result.ok)return JSON.stringify({{ok:false,step:'archive_old',id,status:result.status,restored:restoreArchived()}});
      archived.push(id);
    }}
    const after=course(input.sequence_id);
    const active=(after?.email_templates||[]).filter(e=>e.state==='active');
    const activeIds=active.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0)).map(e=>e.id);
    const exact=activeIds.length===input.new_ids.length&&input.new_ids.every((id,index)=>activeIds[index]===id);
    if(!exact)return JSON.stringify({{ok:false,step:'verify_active',active_ids:activeIds,restored:restoreArchived()}});
    return JSON.stringify({{ok:true,active_count:active.length,archived}});
  }}
  if('{operation}'==='inspect_sequence'){{
    const current=course(input.sequence_id);
    const emails=current?.email_templates||[];
    return JSON.stringify({{ok:!!current,id:current?.id,name:current?.name,state:current?.available?'available':'inactive',emails:emails.map(e=>({{id:e.id,state:e.state,position:e.position,send_offset:e.send_offset,offset_units:e.offset_units,subject:e.subject}}))}});
  }}
  if('{operation}'==='verify_emails'){{
    const mismatches=[];
    for(const expected of input.emails){{
      const email=full(expected.id);
      const version=input.published?email?.document:email?.unpublished_version;
      if(!email)mismatches.push({{key:expected.key,field:'missing'}});
      else if(email.state!==(input.published?'active':'draft'))mismatches.push({{key:expected.key,field:'state'}});
      else if(email.send_offset!==expected.offset_value)mismatches.push({{key:expected.key,field:'offset'}});
      else if(email.offset_units!==expected.offset_unit)mismatches.push({{key:expected.key,field:'offset_units'}});
      else if(version?.subject!==expected.subject)mismatches.push({{key:expected.key,field:'subject'}});
      else if(version?.value_html!==expected.html_body)mismatches.push({{key:expected.key,field:'html'}});
    }}
    return JSON.stringify({{ok:mismatches.length===0,count:input.emails.length,mismatches}});
  }}
  if('{operation}'==='verify_automations'){{
    const pageRequest=new XMLHttpRequest();
    pageRequest.open('GET','/automations',false);
    pageRequest.send();
    if(pageRequest.status<200||pageRequest.status>=300){{
      return JSON.stringify({{ok:false,error:'automation_list_failed',status:pageRequest.status}});
    }}
    const pageDocument=new DOMParser().parseFromString(pageRequest.responseText,'text/html');
    const pageNode=pageDocument.querySelector('[data-page]');
    let page={{}};
    try{{page=JSON.parse(pageNode?.getAttribute('data-page')||'{{}}')}}catch{{page={{}}}}
    const current=page.props?.automations||[];
    const mismatches=[];
    for(const expected of input.automations||[]){{
      const actual=current.find(item=>Number(item.id)===Number(expected.id));
      if(!actual)mismatches.push({{id:expected.id,field:'missing'}});
      else if(actual.name!==expected.name)mismatches.push({{id:expected.id,field:'name'}});
      else if(!actual.active||!actual.live)mismatches.push({{id:expected.id,field:'inactive'}});
      else if(actual.disabled)mismatches.push({{id:expected.id,field:'disabled'}});
      else if(actual.should_show_broken_node_warning)mismatches.push({{id:expected.id,field:'broken'}});
    }}
    return JSON.stringify({{ok:mismatches.length===0,count:input.automations.length,mismatches}});
  }}
  if('{operation}'==='inspect_automation_graph'){{
    const graphRequest=new XMLHttpRequest();
    graphRequest.open('GET','/automations/'+input.id,false);
    graphRequest.setRequestHeader('Accept','text/html');
    graphRequest.send();
    if(graphRequest.status<200||graphRequest.status>=300){{
      return JSON.stringify({{ok:false,error:'automation_graph_failed',status:graphRequest.status}});
    }}
    const graphDocument=new DOMParser().parseFromString(graphRequest.responseText,'text/html');
    const graph=graphDocument.querySelector('workflow-graph');
    if(!graph)return JSON.stringify({{ok:false,error:'automation_graph_missing'}});
    let nodes=[];
    try{{nodes=JSON.parse(graph?.getAttribute('data-nodes')||'[]')}}catch{{nodes=[]}}
    const normalize=node=>({{
      id:Number(node.id),
      kind:node.kind,
      type:node.type,
      name:node.name,
      resource_type:node.resource_type||node.detail?.resource_type||null,
      resource_id:(node.resource_id??node.detail?.resource_id)==null
        ?null:Number(node.resource_id??node.detail?.resource_id),
      sources:(node.sources||[]).map(Number).sort((a,b)=>a-b),
      siblings:(node.siblings||[]).map(Number).sort((a,b)=>a-b),
      errors:node.errors||[]
    }});
    const actual=nodes.map(normalize).sort((a,b)=>a.id-b.id);
    const expected=(input.nodes||[]).map(normalize).sort((a,b)=>a.id-b.id);
    const matches=JSON.stringify(actual)===JSON.stringify(expected);
    return JSON.stringify({{
      ok:matches,
      expected_count:expected.length,
      actual_count:actual.length,
      mismatch:matches?null:{{expected,actual}}
    }});
  }}
  if('{operation}'==='preview_emails'||'{operation}'==='send_test_emails'){{
    const failures=[];
    let recipient=window.app?.user?.email;
    if(!recipient){{
      try{{
        const page=JSON.parse(document.querySelector('[data-page]')?.getAttribute('data-page')||'{{}}');
        recipient=page.props?.layoutConfig?.components?.navbar?.data?.userInfo?.email;
      }}catch{{recipient=null}}
    }}
    if(!recipient){{
      try{{
        const accountRequest=new XMLHttpRequest();
        accountRequest.open('GET','/automations',false);
        accountRequest.send();
        const accountDocument=new DOMParser().parseFromString(accountRequest.responseText,'text/html');
        const page=JSON.parse(accountDocument.querySelector('[data-page]')?.getAttribute('data-page')||'{{}}');
        recipient=page.props?.layoutConfig?.components?.navbar?.data?.userInfo?.email;
      }}catch{{recipient=null}}
    }}
    if('{operation}'==='send_test_emails'&&!recipient)return JSON.stringify({{ok:false,error:'missing_account_email'}});
    for(const email of input.emails){{
      const path='{operation}'==='preview_emails'
        ?'/api/v3/email_templates/'+email.id+'/preview?standalone=true&unpublished=true'
        :'/api/v3/email_templates/'+email.id+'/send_email_preview?unpublished=true';
      const data='{operation}'==='preview_emails'
        ?{{content:email.html_body,id:email.id}}
        :{{content:email.html_body,id:email.id,subject:email.subject,recipient}};
      const result=req('POST',path,data);
      const previewHtml=result.data?.data;
      const valid=result.ok&&('{operation}'==='send_test_emails'||(typeof previewHtml==='string'&&previewHtml.length>email.html_body.length));
      if(!valid)failures.push({{key:email.key,status:result.status}});
    }}
    return JSON.stringify({{ok:failures.length===0,count:input.emails.length,failures}});
  }}
  return JSON.stringify({{ok:false,error:'unknown_operation'}});
}}catch(error){{return JSON.stringify({{ok:false,error:String(error)}})}}
}})()""".replace("\n", "")


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    sequences = config.get("sequences", [])
    expected = {"Unbooked": 36, "Booked": 4, "No Show": 3, "Boost Live": 4}
    counts = {sequence["name"]: len(sequence.get("emails", [])) for sequence in sequences}
    if counts != expected:
        raise InstallError(f"Unexpected sequence counts: {counts}")
    expected_automations = {
        "LP form immediate enrollment": 2052038,
        "Calendly booked": 1987920,
        "Calendly no-show": 1994621,
        "Boost Live enrollment": 2052034,
    }
    automations = {
        automation.get("name"): automation.get("id")
        for automation in config.get("automations", [])
    }
    if automations != expected_automations:
        raise InstallError(f"Unexpected automation routing: {automations}")
    for automation in config["automations"]:
        nodes = automation.get("nodes", [])
        node_ids = {node.get("id") for node in nodes}
        if not nodes or len(node_ids) != len(nodes):
            raise InstallError(f"Invalid automation nodes: {automation['name']}")
        for node in nodes:
            if any(source not in node_ids for source in node.get("sources", [])):
                raise InstallError(
                    f"Invalid automation edge in {automation['name']}: {node}"
                )
    all_copy = json.dumps(config, ensure_ascii=False).lower()
    found = [phrase for phrase in BANNED_COPY if phrase in all_copy]
    if found:
        raise InstallError(f"Banned claims remain in configuration: {', '.join(found)}")
    return config


def inspect(window: int, tab: int, sequence_id: int) -> dict:
    return browser_json(window, tab, operation_script("inspect_sequence", {"sequence_id": sequence_id}))


def active_email_ids(current: dict) -> list[int]:
    active = [email for email in current.get("emails", []) if email.get("state") == "active"]
    active.sort(key=lambda email: (email.get("position", 0), email.get("id", 0)))
    return [email["id"] for email in active]


def live_sequence_matches(
    sequence: dict,
    current: dict,
    window: int,
    tab: int,
) -> tuple[bool, list[int]]:
    email_ids = active_email_ids(current)
    if current.get("state") != "available" or len(email_ids) != len(sequence["emails"]):
        return False, email_ids
    payload_emails = [
        {**email, "id": email_id}
        for email, email_id in zip(sequence["emails"], email_ids)
    ]
    result = browser_json(
        window,
        tab,
        operation_script(
            "verify_emails",
            {"published": True, "emails": payload_emails},
        ),
    )
    return bool(result.get("ok")), email_ids


def verify_automation_graphs(config: dict, window: int, tab: int) -> None:
    for automation in config["automations"]:
        result = browser_json(
            window,
            tab,
            operation_script(
                "inspect_automation_graph",
                {"id": automation["id"], "nodes": automation["nodes"]},
            ),
        )
        if not result.get("ok"):
            raise InstallError(
                f"Could not verify {automation['name']} graph: {result}"
            )
    print(f"verified automation graphs: {len(config['automations'])} immutable graphs")


def stage(config: dict, state_path: Path, window: int, tab: int) -> dict:
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    else:
        state = {"sequences": {}}

    by_name = {sequence["name"]: sequence for sequence in config["sequences"]}
    first_target = inspect(window, tab, by_name["Unbooked"]["target_id"])
    if not first_target.get("ok") or not first_target.get("emails"):
        raise InstallError("Could not inspect the existing unbooked sequence")
    first_email = first_target["emails"][0]
    full_first = browser_json(
        window,
        tab,
        "(()=>{const x=new XMLHttpRequest();x.open('GET','/email_templates/"
        + str(first_email["id"])
        + "',false);x.setRequestHeader('Accept','application/json');x.send();const e=JSON.parse(x.responseText);return JSON.stringify({ok:x.status===200,layout_id:e.email_layout_template_id})})()",
    )
    layout_id = full_first.get("layout_id")
    if not layout_id:
        raise InstallError("Could not determine the account email layout template")

    for name in SEQUENCE_NAMES:
        sequence = by_name[name]
        sequence_state = state["sequences"].setdefault(name, {})
        sequence_id = sequence.get("target_id") or sequence_state.get("id")
        if not sequence_id:
            result = browser_json(
                window,
                tab,
                operation_script(
                    "create_sequence",
                    {"layout_id": layout_id, "name": TARGET_NAMES[name]},
                ),
            )
            if not result.get("ok"):
                raise InstallError(f"Could not create {name}: {result}")
            sequence_id = result["id"]
            sequence_state["id"] = sequence_id

        current = inspect(window, tab, sequence_id)
        if not current.get("ok"):
            raise InstallError(f"Could not inspect {name}: {current}")
        if current.get("name") != TARGET_NAMES[name]:
            raise InstallError(
                f"Refusing to modify {name}: target sequence name does not match"
            )
        matches_live, current_active_ids = live_sequence_matches(
            sequence,
            current,
            window,
            tab,
        )
        if matches_live:
            sequence_state.update({
                "id": sequence_id,
                "old_ids": [],
                "new_ids": current_active_ids,
                "reuse_active": True,
            })
            print(f"reused {name}: {len(current_active_ids)} active emails")
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
            continue
        sequence_state["id"] = sequence_id
        sequence_state["old_ids"] = current_active_ids
        sequence_state["new_ids"] = []
        sequence_state["reuse_active"] = False

        for email in sequence["emails"]:
            result = browser_json(
                window,
                tab,
                operation_script(
                    "stage_email",
                    {
                        "sequence_id": sequence_id,
                        "subject": email["subject"],
                        "offset_value": email["offset_value"],
                        "offset_unit": email["offset_unit"],
                        "html_body": email["html_body"],
                    },
                ),
            )
            if not result.get("ok"):
                raise InstallError(f"Could not stage {name} {email['key']}: {result}")
            sequence_state["new_ids"].append(result["id"])
            print(f"staged {name} {email['key']} as {result['id']}")

        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    return state


def verify(config: dict, state: dict, window: int, tab: int, published: bool) -> None:
    by_name = {sequence["name"]: sequence for sequence in config["sequences"]}
    for name in SEQUENCE_NAMES:
        expected = by_name[name]["emails"]
        sequence_state = state["sequences"][name]
        if len(sequence_state["new_ids"]) != len(expected):
            raise InstallError(f"{name} staged ID count mismatch")
        payload_emails = [
            {**email, "id": email_id}
            for email, email_id in zip(expected, sequence_state["new_ids"])
        ]
        expected_published = published or sequence_state.get("reuse_active") is True
        result = browser_json(
            window,
            tab,
            operation_script(
                "verify_emails",
                {"published": expected_published, "emails": payload_emails},
            ),
        )
        if not result.get("ok"):
            raise InstallError(f"Could not verify {name}: {result.get('mismatches')}")
        wanted_state = "active" if expected_published else "draft"
        print(f"verified {name}: {result['count']} {wanted_state} emails")
        if expected_published:
            sequence_id = sequence_state.get("id") or by_name[name].get("target_id")
            current = inspect(window, tab, sequence_id)
            if not current.get("ok") or current.get("state") != "available":
                raise InstallError(f"{name} sequence is not available")
    if published:
        routing = browser_json(
            window,
            tab,
            operation_script(
                "verify_automations",
                {"automations": config["automations"]},
            ),
        )
        if not routing.get("ok"):
            raise InstallError(
                f"Could not verify automation routing: {routing.get('mismatches') or routing}"
            )
        print(f"verified automation routing: {routing['count']} live automations")
        verify_automation_graphs(config, window, tab)


def activate(config: dict, state: dict, window: int, tab: int) -> None:
    by_name = {sequence["name"]: sequence for sequence in config["sequences"]}
    for name in SEQUENCE_NAMES:
        sequence_state = state["sequences"][name]
        if sequence_state.get("reuse_active") is True:
            print(f"kept {name}: {len(sequence_state['new_ids'])} active emails")
            continue
        published_ids = []
        try:
            for email_id in sequence_state["new_ids"]:
                result = browser_json(
                    window,
                    tab,
                    operation_script("publish_email", {"id": email_id}),
                )
                if not result.get("ok"):
                    raise InstallError(f"Could not publish {name} email {email_id}: {result}")
                published_ids.append(email_id)
            result = browser_json(
                window,
                tab,
                operation_script(
                    "finalize_sequence",
                    {
                        "sequence_id": sequence_state.get("id") or by_name[name].get("target_id"),
                        "new_ids": sequence_state["new_ids"],
                        "old_ids": [
                            email_id
                            for email_id in sequence_state.get("old_ids", [])
                            if email_id not in sequence_state["new_ids"]
                        ],
                        "activate_sequence": True,
                    },
                ),
            )
            if not result.get("ok"):
                raise InstallError(f"Could not finalize {name}: {result}")
            print(f"activated {name}: {result['active_count']} emails")
        except Exception:
            for email_id in published_ids:
                browser_json(window, tab, operation_script("set_draft", {"id": email_id}))
            raise


def selected_tests(config: dict, state: dict) -> list[dict]:
    wanted_by_name = {
        "Unbooked": {"E2", "E3", "E10", "E22"},
        "Booked": {"K1", "K3"},
        "No Show": {"N1", "N2", "N3"},
        "Boost Live": {"K5", "K7"},
    }
    selected = []
    by_name = {sequence["name"]: sequence for sequence in config["sequences"]}
    wanted = set()
    for name in SEQUENCE_NAMES:
        if state["sequences"][name].get("reuse_active") is True:
            continue
        wanted.update(wanted_by_name[name])
        for email, email_id in zip(
            by_name[name]["emails"], state["sequences"][name]["new_ids"]
        ):
            if email["key"] in wanted_by_name[name]:
                selected.append({**email, "id": email_id})
    if not wanted:
        raise InstallError("No staged emails require preview")
    if {email["key"] for email in selected} != wanted:
        raise InstallError("Could not resolve all selected preview emails")
    return selected


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=(
            "plan",
            "stage",
            "verify-stage",
            "preview",
            "test-send",
            "activate",
            "verify-live",
        ),
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        config = load_config(args.config)
        if args.command == "plan":
            email_count = sum(len(sequence["emails"]) for sequence in config["sequences"])
            print(f"validated {email_count} emails and 4 automation routes")
            return 0
        window, tab = find_kit_tab()
        if args.command == "stage":
            state = stage(config, args.state, window, tab)
            verify(config, state, window, tab, published=False)
            return 0
        if not args.state.exists():
            raise InstallError("Run stage first; installation state is missing")
        state = json.loads(args.state.read_text(encoding="utf-8"))
        if args.command == "verify-stage":
            verify(config, state, window, tab, published=False)
        elif args.command in ("preview", "test-send"):
            verify(config, state, window, tab, published=False)
            operation = "preview_emails" if args.command == "preview" else "send_test_emails"
            result = browser_json(
                window,
                tab,
                operation_script(operation, {"emails": selected_tests(config, state)}),
            )
            if not result.get("ok"):
                raise InstallError(f"Selected email {args.command} failed: {result}")
            print(f"verified {result['count']} selected emails via {args.command}")
        elif args.command == "activate":
            verify(config, state, window, tab, published=False)
            activate(config, state, window, tab)
            verify(config, state, window, tab, published=True)
        else:
            verify(config, state, window, tab, published=True)
        return 0
    except (InstallError, OSError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
