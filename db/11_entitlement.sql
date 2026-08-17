-- ============================================================================
--  What Gardening Today? — entitlement structure + inventory guard (file 11)
--
--  DORMANT BY CONSTRUCTION. This file creates no products and grants no
--  entitlements, so on the day it runs every blueprint is core, every user may
--  add anything, and the picker is unchanged. It exists now because retrofitting
--  it later would mean a migration touching every blueprint, the picker, and the
--  add path at once — whereas installing it empty costs nothing and changes
--  nothing.
--
--  RUN THIS AFTER 10_activity.sql, in the Supabase SQL Editor
--  (Project -> SQL Editor -> New query -> paste -> Run). Idempotent-friendly.
--
--  ---------------------------------------------------------------------
--  THE GOVERNING PRINCIPLE, because everything below follows from it:
--
--      ENTITLEMENT GRANTS THE RIGHT TO **ADD**, NOT THE RIGHT TO **SEE**.
--
--  Once an item is in a garden it belongs to the garden. Every member sees it,
--  every member gets its tasks, and nothing ever takes that away — not a lapsed
--  subscription, not a refund, not the entitled member leaving. Only the act of
--  ADDING a pack item asks whether you are entitled.
--
--  This is why the check is a BEFORE INSERT trigger on garden_item and appears
--  nowhere in select_tasks. Horticultural advice is never gated (SPEC §1); a
--  paywall that could withhold care instructions for a plant somebody is
--  actually growing would be both a product failure and a safety one.
--  ---------------------------------------------------------------------
--
--  WHY A JUNCTION TABLE AND NOT A COLUMN ON blueprint: a column would say
--  "this plant belongs to pack X", which forces one pack per plant and makes
--  a plant sellable in only one bundle forever. pack_member says "this pack
--  contains these plants", which allows the same plant in several packs —
--  entitlement to ANY of them is enough. It is also the exact shape of
--  collection_member, so it reads like the rest of the schema. There is
--  deliberately no second representation of the same fact to drift out of step.
--
--  WHAT IS NOT HERE, on purpose: prices (they live in the App Store and Play
--  Console, which are the merchants of record — never in our database), receipt
--  validation, restore-purchases, and any paywall UI. All of that is cheap to
--  add when there is something to sell and expensive to maintain before then.
-- ============================================================================


-- ============================================================================
--  1. PRODUCT — the things that can be owned.
--
--     Two kinds, deliberately in one table rather than two:
--       'pack'    — unlocks a set of blueprints (e.g. house plants, exotics)
--       'feature' — unlocks an app capability (e.g. the Home Screen widget)
--
--     They share the same ownership plumbing, so splitting them would mean two
--     entitlement tables and two of every query. The kind column distinguishes
--     them where it matters, which is exactly one place: only a 'pack' may
--     contain blueprints, and §2 makes that structural rather than hopeful.
--
--     code is authored (PACK_HOUSE_PLANTS) and never parsed — same discipline
--     as collection.code and blueprint.legacy_code.
-- ============================================================================
create table if not exists public.product (
  id         integer     generated always as identity primary key,
  code       text        not null unique,
  name       text        not null,
  kind       text        not null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),

  constraint product_code_not_blank check (btrim(code) <> ''),
  constraint product_name_not_blank check (btrim(name) <> ''),
  constraint product_kind check (kind in ('pack','feature'))
);

-- Supports the composite foreign key in §2. Redundant as a uniqueness claim
-- (id is already the primary key), and present for exactly the same reason
-- garden_item carries UNIQUE (id, garden_id): to let another table point at
-- "this row, AND this fact about it".
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product'::regclass and conname = 'product_id_kind_uq'
  ) then
    alter table public.product add constraint product_id_kind_uq unique (id, kind);
  end if;
end $$;

comment on table public.product is
  'Things that can be owned: content packs and paid features. Retired, never deleted.';
comment on column public.product.code is
  'Authored identifier (PACK_HOUSE_PLANTS). A label, never parsed by any logic.';
comment on column public.product.retired_at is
  'Withdrawn from sale. A retired pack RELEASES its blueprints back to core — see can_add_blueprint().';


-- ============================================================================
--  2. PACK_MEMBER — which blueprints each pack contains.
--
--     The composite foreign key (product_id, product_kind) -> product (id, kind),
--     with product_kind pinned to 'pack' by a check constraint, means a
--     'feature' product CANNOT be given blueprint members. Not "should not":
--     the row is unrepresentable. Same technique as the task/garden_item
--     composite key in 01_schema.sql, and the same motivation — an integrity
--     rule the database enforces is worth more than one the audit reports.
--
--     A blueprint may appear in several packs. Owning any one of them is enough.
-- ============================================================================
create table if not exists public.pack_member (
  product_id   integer not null,
  product_kind text    not null default 'pack',
  blueprint_id integer not null references public.blueprint(id),

  primary key (product_id, blueprint_id),
  constraint pack_member_kind_is_pack check (product_kind = 'pack'),
  constraint pack_member_product_fk
    foreign key (product_id, product_kind) references public.product (id, kind)
);

create index if not exists idx_pack_member_blueprint
  on public.pack_member (blueprint_id);

comment on table public.pack_member is
  'Which blueprints a pack contains. A blueprint in NO live pack is core (free). '
  'Same shape as collection_member. Only kind=''pack'' products can appear here.';


-- ============================================================================
--  3. ENTITLEMENT — who owns what.
--
--     ON THE USER, NOT THE GARDEN. Someone who tends their own garden and a
--     relative's is one person who bought one thing; charging them twice would
--     be both unfair and backwards, since they are the most engaged kind of
--     user there is. The many-to-many garden_member table already allows one
--     user to hold several gardens, so this follows the grain of the schema.
--
--     PRIMARY KEY (user_id, product_id) makes granting IDEMPOTENT by
--     construction — the same reasoning as hidden_task's composite key. A
--     renewal updates expires_at rather than adding a row.
--
--     TRADE-OFF, recorded deliberately: this table holds current state, not
--     purchase history. Renewal and refund history lives with the store, which
--     is the merchant of record and keeps the receipts. We hold only the answer
--     to "may this person add this today?".
--
--     expires_at null  = perpetual (a one-off purchase — the preferred model
--                        for a seasonal product, because there is nothing to
--                        churn in November)
--     expires_at set   = a subscription period, or a revocation when set to
--                        a past time. Revoking never deletes the row.
-- ============================================================================
create table if not exists public.entitlement (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  product_id integer     not null references public.product(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  source     text        not null default 'purchase',
  note       text,

  primary key (user_id, product_id),
  constraint entitlement_source check (source in ('purchase','gift','founder','test'))
);

comment on table public.entitlement is
  'What a USER owns (not a garden). Null expires_at = perpetual. Revoke by setting '
  'expires_at to the past, never by deleting. Cascades on user deletion.';
comment on column public.entitlement.source is
  'How it was acquired. ''founder'' exists for the friends-and-family circle who were here first.';


-- ============================================================================
--  4. THE TWO QUESTIONS ANYTHING EVER ASKS
--
--     Both are SECURITY DEFINER so they can read entitlement (which users
--     cannot read for anyone but themselves), and both pin search_path empty
--     with fully-qualified names so a caller's path cannot hijack them —
--     the same posture as is_garden_member.
--
--     Both answer for the CURRENT caller. There is deliberately no
--     "does user X own Y" form: nothing in the app needs to ask about
--     somebody else, and not providing it means it cannot be misused.
-- ============================================================================

-- Does the caller hold a live entitlement to this product code?
-- For paid FEATURES (the widget, the week-ahead view).
create or replace function public.has_entitlement(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entitlement e
    join public.product p on p.id = e.product_id
    where e.user_id = auth.uid()
      and p.code = p_code
      and p.retired_at is null
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

-- May the caller ADD this blueprint to a garden?
-- True when the blueprint is core, OR when they hold a live entitlement to a
-- live pack containing it.
--
-- NOTE THE RETIREMENT RULE: only LIVE packs gate. Retiring a pack therefore
-- releases its blueprints back to core rather than stranding them somewhere
-- nobody can reach. That is the deliberate failure direction — a withdrawn
-- product must never leave a plant permanently un-addable, because that would
-- put its care advice out of reach too.
create or replace function public.can_add_blueprint(p_blueprint_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- core: in no live pack
    not exists (
      select 1
      from public.pack_member pm
      join public.product p on p.id = pm.product_id
      where pm.blueprint_id = p_blueprint_id
        and p.retired_at is null
    )
    or
    -- entitled to a live pack that contains it
    exists (
      select 1
      from public.pack_member pm
      join public.product p     on p.id = pm.product_id
      join public.entitlement e on e.product_id = p.id
      where pm.blueprint_id = p_blueprint_id
        and e.user_id = auth.uid()
        and p.retired_at is null
        and (e.expires_at is null or e.expires_at > now())
    );
$$;

comment on function public.has_entitlement(text) is
  'Does the CALLER hold a live entitlement to this product code? For paid features.';
comment on function public.can_add_blueprint(integer) is
  'May the CALLER add this blueprint? True for core items and for packs they own. '
  'Asked only when ADDING — never when reading, matching, or advising.';


-- ============================================================================
--  5. THE GUARD ON ADDING AN ITEM
--
--     Two unrelated checks share one trigger because they fire at the same
--     moment and a second trigger on the same event would be a second thing
--     to remember:
--
--     (a) THE INVENTORY CEILING. This is NOT a paywall, and deliberately so.
--         A cap that binds pushes users to leave things OUT of their inventory
--         to stay under it — and then the app is advising on a garden it can no
--         longer see properly, which degrades the recommendations to sell a
--         subscription. It is an abuse and performance guard: garden inventory
--         is the one user-controlled input to select_tasks' cost, which walks
--         every active item on every open. 200 is far above any real garden
--         (a mature garden plus an allotment might reach 80) and is invisible
--         in the UI until somebody approaches it.
--
--     (b) THE ENTITLEMENT CHECK. Dormant until packs exist.
--
--     IN THE DATABASE, NOT THE FRONTEND: app.js and config.js are public files
--     served with a published key. A check that lives only in the browser is
--     decorative.
--
--     THE auth.uid() BYPASS: a null caller means the service role or the SQL
--     editor — the publish pipeline, a restore, an admin fix. Those are trusted
--     and must not be blocked by a user-facing rule. A signed-in user cannot
--     reach this state, because RLS already refuses them any garden but their own.
--
--     KNOWN GAP, recorded rather than silently accepted: this fires on INSERT
--     only. Removal is a soft delete (removed_at), so a "restore a removed item"
--     feature would be an UPDATE and would slip past both checks. If that
--     feature is ever built, this trigger needs an UPDATE branch for rows where
--     removed_at goes from set to null.
-- ============================================================================
create or replace function public.garden_item_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The one dial. Recorded in docs/CONFIG_ITEMS.md.
  v_max_items constant integer := 200;
  v_active    integer;
begin
  -- Trusted context (service role / SQL editor): nothing to check.
  if auth.uid() is null then
    return new;
  end if;

  select count(*) into v_active
  from public.garden_item gi
  where gi.garden_id = new.garden_id
    and gi.removed_at is null;

  if v_active >= v_max_items then
    raise exception
      'This garden already holds the maximum of % items. Remove something first.', v_max_items
      using errcode = '54000';
  end if;

  if not public.can_add_blueprint(new.blueprint_id) then
    raise exception 'This item belongs to a pack you do not have.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists garden_item_guard_trg on public.garden_item;
create trigger garden_item_guard_trg
  before insert on public.garden_item
  for each row execute function public.garden_item_guard();

comment on function public.garden_item_guard() is
  'BEFORE INSERT on garden_item: enforces the 200-item ceiling and pack entitlement. '
  'Skipped for a null auth.uid() (service role / SQL editor).';


-- ============================================================================
--  6. ACCESS
--
--     File 09 learned this with a 42501: a new table inherits no privileges,
--     and RLS filters ON TOP of ordinary SQL privileges rather than replacing
--     them. A policy without a grant is a lock on a bricked-up door.
--
--     product / pack_member — read by everyone signed in (the picker needs to
--       know which items are in a pack so it can label them), written only by
--       the pipeline. No DELETE grant: products are retired, and pack contents
--       are managed by upsert, following the collection precedent.
--
--     entitlement — a user may READ THEIR OWN and nothing else. No insert,
--       update or delete grant at any level: self-granting must be impossible
--       at the privilege layer, before any policy is consulted. Granting is
--       service-role work, done after the store confirms a purchase.
-- ============================================================================
revoke all on public.product, public.pack_member, public.entitlement from anon, authenticated;

grant select on public.product     to authenticated;
grant select on public.pack_member to authenticated;
grant select on public.entitlement to authenticated;

grant select, insert, update         on public.product     to service_role;
grant select, insert, update, delete on public.pack_member to service_role;
grant select, insert, update, delete on public.entitlement to service_role;

alter table public.product     enable row level security;
alter table public.pack_member enable row level security;
alter table public.entitlement enable row level security;

drop policy if exists product_read on public.product;
create policy product_read on public.product
  for select to authenticated using (true);

drop policy if exists pack_member_read on public.pack_member;
create policy pack_member_read on public.pack_member
  for select to authenticated using (true);

-- The only row-level rule that actually restricts anything here.
drop policy if exists entitlement_read_own on public.entitlement;
create policy entitlement_read_own on public.entitlement
  for select to authenticated using (user_id = auth.uid());

-- Functions are EXECUTE-to-PUBLIC by default, so these revokes are not
-- decorative. The two question-answering functions are for the app; the
-- trigger function is not callable by anyone.
revoke execute on function public.has_entitlement(text)      from public;
revoke execute on function public.can_add_blueprint(integer) from public;
revoke execute on function public.garden_item_guard()        from public;

grant execute on function public.has_entitlement(text)      to authenticated;
grant execute on function public.can_add_blueprint(integer) to authenticated;


-- ============================================================================
--  7. CONFIRMATION READOUT
--     On a first run every count is zero and the trigger count is 1. Zeros are
--     the correct result: the structure is installed and dormant.
-- ============================================================================
select
  (select count(*) from public.product)                      as "Products",
  (select count(*) from public.pack_member)                  as "Pack members",
  (select count(*) from public.entitlement)                  as "Entitlements",
  (select count(*) from pg_trigger
     where tgname = 'garden_item_guard_trg' and not tgisinternal)
                                                             as "Guard (expect 1)",
  (select coalesce(max(n),0) from (
     select count(*) as n from public.garden_item
     where removed_at is null group by garden_id) s)         as "Largest inventory";
