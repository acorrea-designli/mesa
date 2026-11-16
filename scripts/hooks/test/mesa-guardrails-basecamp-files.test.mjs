import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { check, sha256Base64, splitAttachments } from "../mesa-guardrails.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

// t196: files on Basecamp salidas. create_attachment / create_campfire_upload pass only for the salida's exact file
// (name + SHA-256 of the decoded base64); create_message / create_comment pass only with the approved text, the sgids
// that `mesa salida upload` recorded as <bc-attachment> tags, and (a post) status "active" + the approved subscriptions.

const lead = { transcript_path: "C:/x/sess.jsonl", session_id: "sess" };
const run = (base, tool_name, tool_input, fetchImpl = unreachable) => check({ ...base, tool_name, tool_input }, { fetchImpl });
const rule = async (p) => (await p)?.rule ?? null;

const PDF = Buffer.from("%PDF-1.4 the cost report");
const PNG = Buffer.from("not really a png");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const b64 = (b) => b.toString("base64");
const file = (name, buf) => ({ path: `C:/tmp/${name}`, name, size: buf.length, sha256: sha(buf) });
const SG1 = "BAh7CEkiCGdpZAY6BkVUSSIfZ2lkOi8vYmMzL1VwbG9hZC8xMTExMT9leHBpcmVz";
const SG2 = "BAh7CEkiCGdpZAY6BkVUSSIfZ2lkOi8vYmMzL1VwbG9hZC8yMjIyMj9leHBpcmVz";
const tag = (sg) => `<bc-attachment sgid="${sg}"></bc-attachment>`;
const TEXT = "Hey Matt, the report is attached.";

const salida = ({ kind = "basecamp_message", files = [file("report.pdf", PDF)], mentions, uploads = [], recordingId = "55", subject = "Cost report", extra = {}, id = "s1" } = {}) => ({
  id,
  source: "basecamp",
  releasedAt: "2026-11-16T20:00:00Z",
  approvedVersion: 1,
  versions: [{ n: 1, body: TEXT }],
  destination: { kind, project: "Scout", postAs: "A", ...(kind === "basecamp_message" && subject ? { subject } : {}), ...(files ? { files } : {}), ...(mentions ? { mentions } : {}), ...(recordingId ? { recordingId } : {}) },
  uploads: uploads.map((sgid, fileIndex) => ({ fileIndex, sgid, sha256: files[fileIndex]?.sha256 })),
  // t87: a post carries the mode Andrés chose with his approval click; the t196 tests below are about the publishing one.
  sendMode: kind === "basecamp_message" ? "send" : null,
  ...extra,
});
const mesaWith = (...ss) => fakeMesa({ "GET /api/salidas?status=sending": { salidas: ss } });

const upload = (mesa, buf = PDF, filename = "report.pdf") => run(lead, "mcp__basecamp__create_attachment", { filename, content_type: "application/pdf", content_base64: b64(buf) }, mesa.fetchImpl);
const campfireUpload = (mesa, buf = PDF, filename = "report.pdf", campfire_id = 55) =>
  run(lead, "mcp__basecamp__create_campfire_upload", { campfire_id, filename, content_type: "application/pdf", content_base64: b64(buf) }, mesa.fetchImpl);

test("helpers: sha256Base64 hashes the decoded bytes; splitAttachments separates tags from text", () => {
  assert.equal(sha256Base64(b64(PDF)), sha(PDF));
  const r = splitAttachments(`<p>${TEXT}</p>${tag(SG1)}<bc-attachment sgid="${SG2}"/><bc-attachment href="x"></bc-attachment>`);
  assert.deepEqual(r.sgids, [SG1, SG2, null]);
  assert.equal(r.text.includes("bc-attachment"), false);
});

test("G5 upload: create_attachment passes only for the exact file (name and bytes) of a released salida", async () => {
  const mesa = mesaWith(salida());
  assert.equal(await rule(upload(mesa)), null);
  // other bytes under the same name: the file changed after it was approved
  const changed = await upload(mesa, Buffer.from("%PDF-1.4 the cost report v2"));
  assert.equal(changed.rule, "G5");
  assert.match(changed.reason, /not the approved/);
  // same bytes under another name, and a file nobody proposed
  assert.equal(await rule(upload(mesa, PDF, "other.pdf")), "G5");
  assert.equal(await rule(upload(mesa, PNG, "shot.png")), "G5");
});

test("G5 upload: a salida without that file, a sample, an unreleased or a sent one never authorises it; Mesa down blocks", async () => {
  assert.equal(await rule(upload(mesaWith(salida({ files: [file("shot.png", PNG)] })))), "G5");
  assert.equal(await rule(upload(mesaWith(salida({ extra: { isSample: true } })))), "G5");
  assert.equal(await rule(upload(mesaWith(salida({ extra: { releasedAt: null } })))), "G5");
  assert.equal(await rule(upload(mesaWith(salida({ extra: { sentAt: "2026-11-16T20:05:00Z" } })))), "G5");
  assert.equal(await rule(run(lead, "mcp__basecamp__create_attachment", { filename: "report.pdf", content_type: "application/pdf", content_base64: b64(PDF) })), "G5");
});

test("G5 upload: the second file of a salida is found, and the list without destination files is resolved through salida show", async () => {
  const full = salida({ files: [file("report.pdf", PDF), file("shot.png", PNG)] });
  assert.equal(await rule(upload(mesaWith(full), PNG, "shot.png")), null);
  const mesa = fakeMesa({
    "GET /api/salidas?status=sending": { salidas: [{ id: "s1", source: "basecamp", releasedAt: "2026-11-16T20:00:00Z" }] },
    "GET /api/salidas/s1": { salida: full },
  });
  assert.equal(await rule(upload(mesa)), null);
});

test("G5 upload: create_campfire_upload passes only for a Campfire salida's file, in its Campfire", async () => {
  const cf = salida({ kind: "basecamp_campfire" });
  assert.equal(await rule(campfireUpload(mesaWith(cf))), null);
  const noTarget = await campfireUpload(mesaWith(salida({ kind: "basecamp_campfire", recordingId: null })));
  assert.equal(noTarget.rule, "G5");
  assert.match(noTarget.reason, /no recordingId/);
  assert.equal(await rule(campfireUpload(mesaWith(cf), PDF, "report.pdf", "55")), null); // string and number ids compare equal
  const wrong = await campfireUpload(mesaWith(cf), PDF, "report.pdf", 12);
  assert.equal(wrong.rule, "G5");
  assert.match(wrong.reason, /campfire_id 12 is not where the salida goes: its destination is 55/);
  assert.equal(await rule(campfireUpload(mesaWith(cf), Buffer.from("other"))), "G5");
  // each upload tool is for its own kind
  const crossed = await campfireUpload(mesaWith(salida({ kind: "basecamp_message" })));
  assert.equal(crossed.rule, "G5");
  assert.match(crossed.reason, /upload with create_attachment/);
  const crossed2 = await upload(mesaWith(cf));
  assert.equal(crossed2.rule, "G5");
  assert.match(crossed2.reason, /create_campfire_upload/);
});

test("G5 upload: a teammate is blocked by G4 and the sandbox by G11", async () => {
  const mate = fakeAgent({ name: "dev-t196" }).input;
  assert.equal(await rule(run(mate, "mcp__basecamp__create_attachment", { filename: "a", content_type: "x", content_base64: "AA==" })), "G4");
  assert.equal(await rule(run(mate, "Bash", { command: "node G:/WorkSpace/designli/ops/bin/mesa salida upload s1 --file 0 --sgid abc" })), "G4");
});

const post = (mesa, content, extra = {}, tool = "mcp__basecamp__create_message") =>
  run(lead, tool, { board_id: 55, subject: "Cost report", content, ...extra }, mesa.fetchImpl);
const comment = (mesa, content, extra = {}) => run(lead, "mcp__basecamp__create_comment", { recording_id: 55, content, ...extra }, mesa.fetchImpl);

test("G5 post: with files it passes only when the content embeds exactly the recorded sgids next to the approved text", async () => {
  const mesa = mesaWith(salida({ uploads: [SG1] }));
  const ok = { status: "active" };
  assert.equal(await rule(post(mesa, `<p>${TEXT}</p>${tag(SG1)}`, ok)), null);
  assert.equal(await rule(post(mesa, `${tag(SG1)}<p>${TEXT}</p>`, ok)), null);
  // no tag, another sgid, an extra tag, a tag with other attributes
  for (const content of [`<p>${TEXT}</p>`, `<p>${TEXT}</p>${tag(SG2)}`, `<p>${TEXT}</p>${tag(SG1)}${tag(SG2)}`, `<p>${TEXT}</p><bc-attachment sgid="${SG1}" caption="x"></bc-attachment>`]) {
    const r = await post(mesa, content, ok);
    assert.equal(r?.rule, "G5", content);
    assert.match(r.reason, /exactly the uploaded files' sgids/);
  }
  // different text with the right tag
  assert.equal(await rule(post(mesa, `<p>Another text</p>${tag(SG1)}`, ok)), "G5");
});

test("G5 post: a file that was not uploaded and recorded yet blocks the post and says what to do", async () => {
  const mesa = mesaWith(salida({ files: [file("report.pdf", PDF), file("shot.png", PNG)], uploads: [SG1] }));
  const r = await post(mesa, `<p>${TEXT}</p>${tag(SG1)}`, { status: "active" });
  assert.equal(r.rule, "G5");
  assert.match(r.reason, /missing: shot\.png/);
  assert.match(r.reason, /mesa salida upload/);
  // an upload recorded against other bytes is not an upload of this file
  const stale = salida({ uploads: [SG1] });
  stale.uploads[0].sha256 = "0".repeat(64);
  assert.equal(await rule(post(mesaWith(stale), `<p>${TEXT}</p>${tag(SG1)}`, { status: "active" })), "G5");
});

test("G5 post: two files need both sgids", async () => {
  const mesa = mesaWith(salida({ files: [file("report.pdf", PDF), file("shot.png", PNG)], uploads: [SG1, SG2] }));
  assert.equal(await rule(post(mesa, `<p>${TEXT}</p>${tag(SG2)}${tag(SG1)}`, { status: "active" })), null);
  assert.equal(await rule(post(mesa, `<p>${TEXT}</p>${tag(SG1)}`, { status: "active" })), "G5");
});

test("G5 comment: files embed the same way, mentions are still compared", async () => {
  const mesa = mesaWith(salida({ kind: "basecamp_comment", uploads: [SG1], mentions: [{ id: "9001", name: "Matt" }] }));
  assert.equal(await rule(comment(mesa, `<p>${TEXT}</p>${tag(SG1)}`, { mentions: [9001] })), null);
  assert.equal(await rule(comment(mesa, `<p>${TEXT}</p>`, { mentions: [9001] })), "G5");
  const wrongMention = await comment(mesa, `<p>${TEXT}</p>${tag(SG1)}`, { mentions: [9002] });
  assert.equal(wrongMention.rule, "G5");
  assert.match(wrongMention.reason, /mentions do not/);
});

test("G5 post: a salida with no files refuses a content that embeds an attachment, and still passes plain", async () => {
  const mesa = mesaWith(salida({ files: null }));
  assert.equal(await rule(post(mesa, `<p>${TEXT}</p>`, { status: "active" })), null);
  const r = await post(mesa, `<p>${TEXT}</p>${tag(SG1)}`, { status: "active" });
  assert.equal(r.rule, "G5");
  assert.match(r.reason, /carries no files/);
});

test("G5 post: create_message passes status active and exactly the destination's people as subscriptions", async () => {
  const withPeople = mesaWith(salida({ files: null, mentions: [{ id: "9001", name: "Matt Myers" }, { id: "9002", name: "Ana Ruiz" }] }));
  const content = `<p>${TEXT}</p>`;
  assert.equal(await rule(post(withPeople, content, { status: "active", subscriptions: [9002, 9001] })), null);
  for (const extra of [{ status: "active", subscriptions: [9001] }, { status: "active", subscriptions: [9001, 9002, 9003] }, { status: "active", subscriptions: [] }, { status: "active" }]) {
    const r = await post(withPeople, content, extra);
    assert.equal(r?.rule, "G5", JSON.stringify(extra));
    assert.match(r.reason, /people to notify are \[9001, 9002\]/);
  }
});

test("G5 post: a salida that names nobody omits subscriptions; no status or a draft is refused", async () => {
  const none = mesaWith(salida({ files: null }));
  const content = `<p>${TEXT}</p>`;
  assert.equal(await rule(post(none, content, { status: "active" })), null);
  for (const extra of [{ status: "active", subscriptions: [9001] }, { status: "active", subscriptions: [] }]) {
    const r = await post(none, content, extra);
    assert.equal(r?.rule, "G5");
    assert.match(r.reason, /omit `subscriptions`/);
  }
  for (const extra of [{}, { status: "drafted" }]) {
    const r = await post(none, content, extra);
    assert.equal(r?.rule, "G5");
    assert.match(r.reason, /status "active"/);
  }
});

test("G5 Campfire line: plain text as before, files never embedded in it", async () => {
  const cf = salida({ kind: "basecamp_campfire", uploads: [] });
  const mesa = mesaWith(cf);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 55, content: TEXT }, mesa.fetchImpl)), null);
  assert.equal((await run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 55, content: `${TEXT} ${tag(SG1)}` }, mesa.fetchImpl))?.rule, "G5");
});

test("G4: a teammate cannot record an upload", async () => {
  const mate = fakeAgent({ name: "dev-t196" }).input;
  const r = await run(mate, "Bash", { command: "node G:/WorkSpace/designli/ops/bin/mesa salida upload sa_1 --file 0 --sgid BAh7" });
  assert.equal(r?.rule, "G4");
});

test("G5 target: board_id, recording_id and campfire_id must be the destination's recordingId", async () => {
  const content = `<p>${TEXT}</p>`;
  const msg = mesaWith(salida({ files: null }));
  assert.equal(await rule(post(msg, content, { status: "active" })), null);
  const wrongBoard = await run(lead, "mcp__basecamp__create_message", { board_id: 424242, subject: "Cost report", status: "active", content }, msg.fetchImpl);
  assert.equal(wrongBoard.rule, "G5");
  assert.match(wrongBoard.reason, /board_id 424242 is not where the salida goes: its destination is 55/);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_message", { subject: "Cost report", status: "active", content }, msg.fetchImpl)), "G5");

  const com = mesaWith(salida({ kind: "basecamp_comment", files: null }));
  assert.equal(await rule(comment(com, content)), null);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { recording_id: 56, content }, com.fetchImpl)), "G5");

  const cf = mesaWith(salida({ kind: "basecamp_campfire", files: null }));
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 55, content: TEXT }, cf.fetchImpl)), null);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 999, content: TEXT }, cf.fetchImpl)), "G5");
});

test("G5 target: a Basecamp salida without a recordingId sends nothing, whatever the tool", async () => {
  const content = `<p>${TEXT}</p>`;
  for (const [kind, tool, input] of [
    ["basecamp_message", "create_message", { board_id: 55, subject: "Cost report", status: "active", content }],
    ["basecamp_comment", "create_comment", { recording_id: 55, content }],
    ["basecamp_campfire", "create_campfire_line", { campfire_id: 55, content: TEXT }],
  ]) {
    const r = await run(lead, `mcp__basecamp__${tool}`, input, mesaWith(salida({ kind, files: null, recordingId: null })).fetchImpl);
    assert.equal(r?.rule, "G5", tool);
    assert.match(r.reason, /no recordingId/);
  }
});

test("G5 subject: a post passes only with exactly the approved subject; a salida without one sends nothing", async () => {
  const content = `<p>${TEXT}</p>`;
  const mesa = mesaWith(salida({ files: null }));
  assert.equal(await rule(post(mesa, content, { status: "active" })), null);
  for (const subject of ["anything at all", "Cost report 2", "", undefined]) {
    const r = await run(lead, "mcp__basecamp__create_message", { board_id: 55, ...(subject === undefined ? {} : { subject }), status: "active", content }, mesa.fetchImpl);
    assert.equal(r?.rule, "G5", String(subject));
    assert.match(r.reason, /subject must be exactly the approved one, "Cost report"/);
  }
  const legacy = await post(mesaWith(salida({ files: null, subject: null })), content, { status: "active" });
  assert.equal(legacy.rule, "G5");
  assert.match(legacy.reason, /no subject/);
});

test("G5 upload: the base64 must be canonical, so no byte hides after the hash", async () => {
  const mesa = mesaWith(salida());
  const good = b64(PDF);
  assert.equal(await rule(upload(mesa)), null);
  const send = (content_base64) => run(lead, "mcp__basecamp__create_attachment", { filename: "report.pdf", content_type: "application/pdf", content_base64 }, mesa.fetchImpl);
  assert.equal(await rule(send(good.replace(/(.{20})/g, "$1" + String.fromCharCode(10)))), null); // line breaks are not data
  assert.equal((await send(good + "QUJD"))?.rule, "G5"); // canonical, but other bytes: not the approved file
  for (const bad of [good.slice(0, 8) + "!!" + good.slice(8), good + "=", good.slice(0, -1), undefined, 42]) {
    const r = await send(bad);
    assert.equal(r?.rule, "G5", String(bad));
    assert.match(r.reason, /not canonical base64/);
  }
  assert.equal(sha256Base64(Buffer.from("abcd").toString("base64") + "QUJD"), null); // data after the "=" padding
  assert.equal(sha256Base64("YWJjZA== "), sha(Buffer.from("abcd"))); // trailing whitespace is not data
  assert.equal(sha256Base64(undefined), null);
});

test("G10: nobody records an upload through the raw API either", async () => {
  const curl = "curl -s -X POST http://127.0.0.1:8790/api/salidas/sa_1/uploads -H 'content-type: application/json' -d '{\"file\":0,\"sgid\":\"x\"}'";
  for (const who of [lead, fakeAgent({ name: "dev-t196" }).input]) {
    const r = await run(who, "Bash", { command: curl });
    assert.equal(r?.rule, "G10");
  }
  assert.equal(await rule(run(lead, "Bash", { command: "curl -s http://127.0.0.1:8790/api/salidas/sa_1" })), null);
});

test("G5 edit: update_comment and update_message are refused for every salida, files or not", async () => {
  const withFiles = mesaWith(salida({ kind: "basecamp_comment", uploads: [SG1] }), salida({ id: "s2", uploads: [SG1] }));
  const content = `<p>${TEXT}</p>${tag(SG1)}`;
  for (const [tool, input] of [
    ["update_comment", { comment_id: 31337, content }],
    ["update_comment", { comment_id: 55, content }],
    ["update_message", { message_id: 31337, subject: "anything", content }],
    ["update_message", { message_id: 55, subject: "Cost report", status: "active", content }],
  ]) {
    const r = await run(lead, `mcp__basecamp__${tool}`, input, withFiles.fetchImpl);
    assert.equal(r?.rule, "G5", tool);
    assert.match(r.reason, /never edits a Basecamp comment or post/);
  }
  assert.equal(await rule(run(fakeAgent({ name: "dev-t196" }).input, "mcp__basecamp__update_comment", { comment_id: 1, content: "x" })), "G4");
});

test("G5 kind: each text tool serves only a salida of its own kind", async () => {
  const content = `<p>${TEXT}</p>`;
  const comment_ = mesaWith(salida({ kind: "basecamp_comment", files: null }));
  const message = mesaWith(salida({ files: null }));
  const campfire = mesaWith(salida({ kind: "basecamp_campfire", files: null }));
  // a post's board id as a comment target, a comment as a post, a Campfire as either
  const asComment = await run(lead, "mcp__basecamp__create_comment", { recording_id: 55, content }, message.fetchImpl);
  assert.equal(asComment.rule, "G5");
  assert.match(asComment.reason, /is a basecamp_message, not a basecamp_comment/);
  const asPost = await run(lead, "mcp__basecamp__create_message", { board_id: 55, subject: "Cost report", status: "active", content }, comment_.fetchImpl);
  assert.equal(asPost.rule, "G5");
  assert.match(asPost.reason, /is a basecamp_comment, not a basecamp_message/);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 55, content: TEXT }, message.fetchImpl)), "G5");
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { recording_id: 55, content }, campfire.fetchImpl)), "G5");
  // each one still passes with its own tool
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { recording_id: 55, content }, comment_.fetchImpl)), null);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_message", { board_id: 55, subject: "Cost report", status: "active", content }, message.fetchImpl)), null);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 55, content: TEXT }, campfire.fetchImpl)), null);
});

test("G5 kind: an upload is for the tool of the salida's kind and only for kinds with files", async () => {
  assert.equal(await rule(upload(mesaWith(salida({ kind: "basecamp_comment" })))), null);
  assert.equal(await rule(upload(mesaWith(salida({ kind: "basecamp_campfire" })))), "G5");
  assert.equal(await rule(campfireUpload(mesaWith(salida({ kind: "basecamp_comment" })))), "G5");
  assert.equal(await rule(upload(mesaWith(salida({ files: null })))), "G5");
});

// t87: a message-board post carries the send mode like a Slack salida. Draft (the default, also for a salida approved before
// modes existed) = status "drafted", no files, Andrés attaches them and publishes it; send = status "active".
const draftPost = (extra = {}) => salida({ extra: { sendMode: "draft", ...extra } });
const DRAFTED = { status: "drafted" };

test("G5 draft post: create_message passes with status drafted, the approved subject, board and people, and no files", async () => {
  // the salida lists a PDF that was never uploaded: a draft post does not need it uploaded (nor allow it)
  const mesa = mesaWith(draftPost());
  assert.equal(await rule(post(mesa, `<p>${TEXT}</p>`, DRAFTED)), null);
  const withPeople = mesaWith(salida({ files: null, mentions: [{ id: "9001", name: "Matt Myers" }], extra: { sendMode: "draft" } }));
  assert.equal(await rule(post(withPeople, `<p>${TEXT}</p>`, { ...DRAFTED, subscriptions: [9001] })), null);
  for (const extra of [DRAFTED, { ...DRAFTED, subscriptions: [9002] }, { ...DRAFTED, subscriptions: [] }]) {
    const r = await post(withPeople, `<p>${TEXT}</p>`, extra);
    assert.equal(r?.rule, "G5", JSON.stringify(extra));
  }
});

test("G5 draft post: a draft is never published (active, no status, any other status are refused with the right path)", async () => {
  const mesa = mesaWith(draftPost());
  for (const extra of [{ status: "active" }, {}, { status: "published" }]) {
    const r = await post(mesa, `<p>${TEXT}</p>`, extra);
    assert.equal(r?.rule, "G5", JSON.stringify(extra));
    assert.match(r.reason, /approved as a draft/);
    assert.match(r.reason, /status "drafted"/);
    assert.match(r.reason, /--permalink/);
  }
});

test("G5 draft post: a salida released before modes existed carries none and is a draft too (snake_case rows included)", async () => {
  for (const extra of [{ sendMode: null }, { sendMode: undefined }, { sendMode: undefined, send_mode: "draft" }]) {
    const mesa = mesaWith(salida({ extra }));
    assert.equal(await rule(post(mesa, `<p>${TEXT}</p>`, DRAFTED)), null, JSON.stringify(extra));
    assert.equal(await rule(post(mesa, `<p>${TEXT}</p>`, { status: "active" })), "G5", JSON.stringify(extra));
  }
  // the snake_case column wins when the camelCase one is absent
  assert.equal(await rule(post(mesaWith(salida({ files: null, extra: { sendMode: undefined, send_mode: "send" } })), `<p>${TEXT}</p>`, { status: "active" })), null);
});

test("G5 draft post: a send is never drafted", async () => {
  const mesa = mesaWith(salida({ files: null }));
  const r = await post(mesa, `<p>${TEXT}</p>`, DRAFTED);
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /approved as "Claude lo envía"/);
  assert.match(r.reason, /status "active"/);
  assert.equal(await rule(post(mesa, `<p>${TEXT}</p>`, { status: "active" })), null);
});

test("G5 draft post: same text, target, subject and file checks as a send", async () => {
  const mesa = mesaWith(draftPost());
  assert.equal(await rule(post(mesa, `<p>Another text</p>`, DRAFTED)), "G5");
  assert.equal((await post(mesa, `<p>${TEXT}</p>`, { ...DRAFTED, subject: "Other" }))?.rule, "G5");
  assert.equal((await run(lead, "mcp__basecamp__create_message", { board_id: 99, subject: "Cost report", content: `<p>${TEXT}</p>`, ...DRAFTED }, mesa.fetchImpl))?.rule, "G5");
  // a draft carries no files: not an uploaded one, not a stray tag
  const tagged = await post(mesa, `<p>${TEXT}</p>${tag(SG1)}`, DRAFTED);
  assert.equal(tagged.rule, "G5");
  assert.match(tagged.reason, /carries no files/);
  assert.match(tagged.reason, /attaches them himself/);
  // the wrong tool for the kind
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { recording_id: 55, content: `<p>${TEXT}</p>` }, mesa.fetchImpl)), "G5");
  // a sample or an unreleased one never authorises a draft either
  assert.equal(await rule(post(mesaWith(draftPost({ isSample: true })), `<p>${TEXT}</p>`, DRAFTED)), "G5");
  assert.equal(await rule(post(mesaWith(draftPost({ releasedAt: null })), `<p>${TEXT}</p>`, DRAFTED)), "G5");
});

test("G5 draft post: a drafted salida leaves the sending list, so a second create_message has no match (no duplicate drafts)", async () => {
  const none = await post(mesaWith(), `<p>${TEXT}</p>`, DRAFTED);
  assert.equal(none.rule, "G5");
  assert.match(none.reason, /no released salida/);
});

test("G5 draft post: create_attachment is refused for a draft-mode post and still passes for a send", async () => {
  const draft = await upload(mesaWith(draftPost()));
  assert.equal(draft.rule, "G5");
  assert.match(draft.reason, /approved as a draft/);
  assert.match(draft.reason, /attaches "report\.pdf" himself/);
  assert.equal(await rule(upload(mesaWith(salida()))), null);
  // a comment with files has no mode: the upload is unchanged
  assert.equal(await rule(upload(mesaWith(salida({ kind: "basecamp_comment", extra: { sendMode: "draft" } })))), null);
});

test("G4/G11: a teammate never creates the draft, and the sandbox reports it as simulated", async () => {
  const mate = fakeAgent({ name: "dev-t87" }).input;
  assert.equal(await rule(run(mate, "mcp__basecamp__create_message", { board_id: 55, subject: "Cost report", content: TEXT, ...DRAFTED })), "G4");
  const sandboxed = await check({ ...lead, tool_name: "mcp__basecamp__create_message", tool_input: { board_id: 55, subject: "Cost report", content: TEXT, ...DRAFTED } }, { fetchImpl: unreachable, sandbox: true });
  assert.equal(sandboxed?.rule, "G11");
  assert.match(sandboxed.reason, /drafted <id> --simulated/);
});

test("G10: nobody opens a salida file's folder through the raw API (it launches Explorer on Andrés's PC)", async () => {
  const curl = "curl -s -X POST http://127.0.0.1:8790/api/salidas/sa_1/files/0/folder";
  for (const who of [lead, fakeAgent({ name: "dev-t87" }).input]) {
    const r = await run(who, "Bash", { command: curl });
    assert.equal(r?.rule, "G10");
    assert.match(r.reason, /Abrir carpeta/);
  }
  // reading the file itself (the preview) is not a click
  assert.equal(await rule(run(lead, "Bash", { command: "curl -s http://127.0.0.1:8790/api/salidas/sa_1/files/0" })), null);
});
