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

const salida = ({ kind = "basecamp_message", files = [file("report.pdf", PDF)], mentions, uploads = [], recordingId, extra = {}, id = "s1" } = {}) => ({
  id,
  source: "basecamp",
  releasedAt: "2026-11-16T20:00:00Z",
  approvedVersion: 1,
  versions: [{ n: 1, body: TEXT }],
  destination: { kind, project: "Scout", postAs: "A", ...(files ? { files } : {}), ...(mentions ? { mentions } : {}), ...(recordingId ? { recordingId } : {}) },
  uploads: uploads.map((sgid, fileIndex) => ({ fileIndex, sgid, sha256: files[fileIndex]?.sha256 })),
  ...extra,
});
const mesaWith = (...ss) => fakeMesa({ "GET /api/salidas?status=sending": { salidas: ss } });

const upload = (mesa, buf = PDF, filename = "report.pdf") => run(lead, "mcp__basecamp__create_attachment", { filename, content_type: "application/pdf", content_base64: b64(buf) }, mesa.fetchImpl);
const campfireUpload = (mesa, buf = PDF, filename = "report.pdf", campfire_id = 77) =>
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
  const cf = salida({ kind: "basecamp_campfire", recordingId: "77" });
  assert.equal(await rule(campfireUpload(mesaWith(cf))), null);
  assert.equal(await rule(campfireUpload(mesaWith(salida({ kind: "basecamp_campfire" })), PDF, "report.pdf", 12)), null); // no recordingId: nothing to compare
  const wrong = await campfireUpload(mesaWith(cf), PDF, "report.pdf", 12);
  assert.equal(wrong.rule, "G5");
  assert.match(wrong.reason, /not the salida's Campfire/);
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
  run(lead, tool, { board_id: 5, subject: "Cost report", content, ...extra }, mesa.fetchImpl);
const comment = (mesa, content, extra = {}) => run(lead, "mcp__basecamp__create_comment", { recording_id: 9, content, ...extra }, mesa.fetchImpl);

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
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 77, content: TEXT }, mesa.fetchImpl)), null);
  assert.equal((await run(lead, "mcp__basecamp__create_campfire_line", { campfire_id: 77, content: `${TEXT} ${tag(SG1)}` }, mesa.fetchImpl))?.rule, "G5");
});

test("G4: a teammate cannot record an upload", async () => {
  const mate = fakeAgent({ name: "dev-t196" }).input;
  const r = await run(mate, "Bash", { command: "node G:/WorkSpace/designli/ops/bin/mesa salida upload sa_1 --file 0 --sgid BAh7" });
  assert.equal(r?.rule, "G4");
});
