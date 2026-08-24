-- 0017_chat_open.sql defaulted `open` to false under its original, narrower
-- meaning ("can a non-claimant also send"). Decision 12 (chatLock.ts)
-- repurposed `open=false` into "restricted: locks this chat out of Cowork
-- entirely, even for its owner, whenever the owner is online and recently
-- active" -- which turned the old default into a live bug: every new chat
-- starts restricted, and sending your first message in Cowork (which bumps
-- last_message_at to now) immediately locks you out of your own chat.
-- `open` should default to true -- restriction is meant to be something a
-- user opts into via the lock toggle, not the resting state of every chat.
alter table chats alter column open set default true;

-- No chat has ever been intentionally locked under decision 12's semantics
-- yet (the toggle never worked correctly until this fix), so it's safe to
-- unlock every existing chat rather than guessing which false rows were
-- deliberate.
update chats set open = true where open = false;
