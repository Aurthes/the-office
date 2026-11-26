"use strict";
const { userUsage } = require("./office-token-usage");
async function resendUserInput({ store, userSends, controls, native, account, reconcileUserSends }, p) {
  if (p.confirmed !== true || p.requestId === p.originalId) throw new Error('Explicitly confirm resending with a new request ID.');
  store.get(p.threadId); const original = userSends.get(p.threadId, p.originalId);
  if (!original) throw new Error('Saved input was not found.');
  if (original.replacedBy) { if (original.replacedBy !== p.requestId) throw new Error('This input already has a recovery send. Check that item.'); return userSends.receipt(userSends.get(p.threadId, p.requestId)); }
  if (original.state === 'confirmed') return { status: 'confirmed', journalId: p.originalId };
  if (!(await account()).loggedIn) throw new Error('Sign in to Codex for Office before sending');
  await controls.refreshTurn(p.threadId);
  const state = controls.state(p.threadId);
  if (!state.turnStateKnown || state.activeTurnId || state.pendingSends || state.startDispatch || store.starting.has(p.threadId)) throw new Error('Original execution has not been reconciled as stopped. Check or stop it before resending.');
  await reconcileUserSends(p.threadId);
  if (userSends.get(p.threadId, p.originalId)?.state === 'confirmed') return { status: 'confirmed', journalId: p.originalId };
  if (original.dispatchedAt && original.generation === native.scopeGeneration && !original.turnId) throw new Error('Original dispatch has no confirmed turn identity. Do not resend while its outcome is unknown.');
  if (original.turnId && original.generation === native.scopeGeneration) {
    let found = false, cursor;
    for (let n=0;n<4;n++) { const result = await store.call('thread/turns/list',{threadId:p.threadId,limit:50,itemsView:'notLoaded',sortDirection:'desc',...(cursor?{cursor}:{})}); const turn = result.data.find(t=>t.id===original.turnId); if(turn){ found=['completed','failed','interrupted'].includes(turn.status);break; } if(!result.nextCursor)break;cursor=result.nextCursor; }
    if (!found) throw new Error('Original turn is not known to have ended. Keep the saved input and inspect history.');
  }
  const payload = original.payload;
  return controls.send(p.threadId,payload.message,p.requestId,payload.attachments,{references:payload.references,usage:userUsage(payload.sourcePurpose ?? undefined),userSend:{sourcePurpose:payload.sourcePurpose,recoveryOf:p.originalId}});
}

module.exports = { resendUserInput };
