// Landing-page screenshots (D-226), step 1 of 3: turns a freshly seeded LOCAL database into a small, coherent demo.
//
// Capture-only. It never runs in the app, the API or a test, and it refuses anything but a local database. It rewrites
// six seeded plans into the ones the landing page talks about (board games in Gachibowli, a Sunday 5K at KBR Park,
// open mic at Lamakaan, chai in Madhapur, a day trek to Ananthagiri, a Charminar heritage walk), gives seeded members
// #1-#8 real face photos (Pexels licence, see apps/web/public/landing/photos/CREDITS.md) and every curated plan a
// matching cover, keeps those plans small, moves every other upcoming plan out of the way, and writes a short
// plan chat. Run it against a throwaway database (`docker compose -p tgcapture …`), never the dev data you test with.
//
//   cd apps/api && node --env-file=../../.env ../mobile/scripts/landing-shots/fixture.mjs
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import sharp from 'sharp';

const {
  DATABASE_URL,
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET_MEDIA,
} = process.env;
if (
  !DATABASE_URL ||
  !/@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL) ||
  process.env.NODE_ENV === 'production'
)
  throw new Error('fixture.mjs only runs against a local capture database');

/** The browser clock the capture uses (capture.mjs): Friday 20 Nov 2026, 6:45 pm IST. Plans are placed after it. */
const IST = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, day, hh, mm) - 330 * 60_000);

/** Pexels photo ids (free licence). Faces: square crop as [centre x, centre y, side], fractions of the width. */
const pexels = (id, w = 1600) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;
const FACES = {
  1: { id: 18054916, crop: [0.4, 0.25, 0.5] },
  2: { id: 33271170, crop: [0.6, 0.25, 0.18] },
  3: { id: 13156306, crop: [0.52, 0.19, 0.45] },
  4: { id: 34643805, crop: [0.53, 0.42, 0.3] },
  5: { id: 15602468, crop: [0.5, 0.2, 0.65] },
  6: { id: 19425131, crop: [0.45, 0.24, 0.8] },
  7: { id: 5151189, crop: [0.55, 0.38, 0.6] },
  8: { id: 15889864, crop: [0.58, 0.43, 0.22] },
};

/** Seeded plan slugs rewritten into the plans the page names; `going` are member numbers. */
const PLANS = [
  {
    slug: 'seedev084',
    title: 'Board games night',
    category: 'board-games',
    place: 'Board game café',
    address: 'Gachibowli, Hyderabad',
    hood: 'Gachibowli',
    at: [17.4401, 78.3489],
    start: IST(20, 19),
    hours: 3,
    capacity: 8,
    host: 1,
    going: [1, 2, 3, 4, 5, 6],
    cover: 8111356,
    description: 'Catan, Codenames and a big table. New to board games? We teach as we go.',
  },
  {
    slug: 'seedev056',
    title: 'Sunday 5K run',
    category: 'running',
    place: 'KBR Park',
    address: 'Gate 1, Jubilee Hills, Hyderabad',
    hood: 'Jubilee Hills',
    at: [17.4239, 78.4258],
    start: IST(22, 6, 30),
    hours: 1.5,
    capacity: 12,
    host: 6,
    going: [1, 2, 4, 6, 8],
    cover: 5038843,
    featured: true,
    description: 'An easy 5K loop at conversation pace, then idli at the gate.',
  },
  {
    slug: 'seedev028',
    title: 'Open mic night',
    category: 'live-music',
    place: 'Lamakaan',
    address: 'Road No. 1, Banjara Hills, Hyderabad',
    hood: 'Banjara Hills',
    at: [17.4156, 78.4347],
    start: IST(21, 19, 30),
    hours: 2.5,
    capacity: 10,
    host: 3,
    going: [2, 3, 5, 7],
    cover: 7754791,
    description: 'Bring a song, a poem or just yourself. Five minutes each.',
  },
  {
    slug: 'seedev001',
    title: 'Chai after work',
    category: 'chai',
    place: 'Irani chai spot',
    address: 'Hitech City Road, Madhapur, Hyderabad',
    hood: 'Madhapur',
    at: [17.4483, 78.3915],
    start: IST(23, 18, 30),
    hours: 1,
    capacity: 6,
    host: 5,
    going: [1, 3, 5],
    cover: 18516399,
    description: 'Irani chai, Osmania biscuits and an hour away from screens.',
  },
  {
    slug: 'seedev003',
    title: 'Day trek to Ananthagiri',
    category: 'trekking',
    place: 'Ananthagiri Hills',
    address: 'Vikarabad, Telangana',
    hood: null,
    at: [17.3141, 77.8615],
    start: IST(28, 6),
    hours: 8,
    capacity: 10,
    host: 8,
    going: [1, 2, 4, 6, 8],
    cover: 6125822,
    description: 'Car-pool from Gachibowli at 6, an easy trail, back by lunch.',
  },
  {
    slug: 'seedev007',
    title: 'Heritage walk at Charminar',
    category: 'heritage-walks',
    place: 'Charminar',
    address: 'Old City, Hyderabad',
    hood: null,
    at: [17.3616, 78.4747],
    start: IST(29, 7),
    hours: 2,
    capacity: 10,
    host: 7,
    going: [2, 3, 7],
    cover: 5615112,
    description: 'Laad Bazaar, Mecca Masjid and breakfast at Nimrah before the crowds.',
  },
];

/** The board games plan chat on Friday evening (member number, minutes after 6 pm, text). */
const CHAT = [
  [6, -25, 'Count me in. First time playing Catan.'],
  [1, 2, 'Booked the big table by the window.'],
  [4, 10, 'Bringing Catan and Codenames.'],
  [3, 31, 'Running 10 minutes late, start without me.'],
  [5, 40, 'Pulling up in 5.'],
  [2, 42, 'Getting chai for the table on the way.'],
];
const DIRECT = { 1: 'Open mic on Saturday, you in?', 3: 'See you at board games tonight!' };

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});
const SIZES = [160, 480, 1080];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Writes the image into an existing asset's sm/md/lg keys, as the media worker would have. */
async function replaceAsset(db, assetId, image) {
  const { rows } = await db.query('select variant_keys from media_assets where id = $1', [assetId]);
  const keys = rows[0]?.variant_keys;
  if (!keys) throw new Error(`asset ${assetId} has no variants`);
  let size = { width: 0, height: 0 };
  for (const [i, name] of ['sm', 'md', 'lg'].entries()) {
    const { data, info } = await sharp(image)
      .resize({ width: SIZES[i], height: SIZES[i], fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET_MEDIA,
        Key: keys[name],
        Body: data,
        ContentType: 'image/webp',
      }),
    );
    size = info;
  }
  await db.query('update media_assets set width = $2, height = $3 where id = $1', [
    assetId,
    size.width,
    size.height,
  ]);
}

async function face(n) {
  const { id, crop } = FACES[n];
  const image = await download(pexels(id, 1600));
  const meta = await sharp(image).metadata();
  const [cx, cy, s] = crop;
  const side = Math.round(s * meta.width);
  const left = Math.max(0, Math.min(meta.width - side, Math.round(cx * meta.width - side / 2)));
  const top = Math.max(0, Math.min(meta.height - side, Math.round(cy * meta.height - side / 2)));
  return sharp(image)
    .extract({ left, top, width: side, height: side })
    .resize(640, 640)
    .jpeg()
    .toBuffer();
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
try {
  await db.query('begin');
  const member = {};
  for (let n = 1; n <= 8; n += 1) {
    const phone = `+9190000${String(10000 + n)}`;
    const { rows } = await db.query(
      `select u.id, p.gender, (select media_asset_id from profile_photos f where f.user_id = u.id order by position limit 1) photo
         from users u join profiles p on p.user_id = u.id where u.phone_e164 = $1`,
      [phone],
    );
    if (!rows[0]) throw new Error(`seed member #${n} is missing; run the dev seed first`);
    member[n] = rows[0];
  }
  const me = member[2].id;
  const curated = PLANS.map((p) => p.slug);

  // Everything else that is upcoming moves six weeks out, so the curated plans are what the screens show.
  await db.query(
    `update events set starts_at = starts_at + interval '42 days', ends_at = ends_at + interval '42 days',
            featured_until = null, featured_rank = null, featured_by = null
      where starts_at > now() - interval '1 day' and slug <> all($1)`,
    [curated],
  );
  await db.query(
    `delete from rsvps r using events e where r.event_id = e.id and r.user_id = $1
        and e.starts_at > now() and e.slug <> all($2)`,
    [me, curated],
  );

  for (const p of PLANS) {
    const { rows } = await db.query(
      `select e.id, e.cover_media_id, i.id interest from events e, interests i where e.slug = $1 and i.slug = $2`,
      [p.slug, p.category],
    );
    const plan = rows[0];
    if (!plan) throw new Error(`plan ${p.slug} or interest ${p.category} is missing`);
    const hood = p.hood
      ? (await db.query('select id from neighbourhoods where name = $1', [p.hood])).rows[0]?.id
      : null;
    const point = `SRID=4326;POINT(${p.at[1]} ${p.at[0]})`;
    await db.query(
      `update events set title = $2, description = $3, category_interest_id = $4, place_name = $5, address = $6,
              neighbourhood_id = coalesce($7, neighbourhood_id), location = $8::geography, approx_center = $8::geography,
              starts_at = $9, ends_at = $10, capacity = $11, visibility = 'public', mystery = false, price_paise = 0,
              refund_policy = null, creator_user_id = $12, status = 'published', held_at = null,
              featured_until = $13, featured_rank = $14, type = $15
        where id = $1`,
      [
        plan.id,
        p.title,
        p.description,
        plan.interest,
        p.place,
        p.address,
        hood,
        point,
        p.start,
        new Date(p.start.getTime() + p.hours * 3_600_000),
        p.capacity,
        member[p.host].id,
        p.featured ? new Date(p.start.getTime() + 86_400_000) : null,
        p.featured ? 1 : null,
        p.featured ? 'curated' : 'plan',
      ],
    );
    await db.query('delete from event_hosts where event_id = $1', [plan.id]);
    await db.query(`insert into event_hosts (event_id, user_id, role) values ($1, $2, 'host')`, [
      plan.id,
      member[p.host].id,
    ]);
    await db.query('delete from rsvps where event_id = $1', [plan.id]);
    for (const n of p.going) {
      const bucket =
        member[n].gender === 'woman' ? 'woman' : member[n].gender === 'man' ? 'man' : 'other';
      await db.query(
        `insert into rsvps (event_id, user_id, status, gender_bucket) values ($1, $2, 'going', $3)`,
        [plan.id, member[n].id, bucket],
      );
    }
    if (plan.cover_media_id)
      await replaceAsset(db, plan.cover_media_id, await download(pexels(p.cover, 1600)));
    plan.slug = p.slug;
    p.id = plan.id;
  }

  for (let n = 1; n <= 8; n += 1)
    if (member[n].photo) await replaceAsset(db, member[n].photo, await face(n));

  // The board games plan gets the member's one plan chat, with a few messages before it starts.
  const board = PLANS[0];
  const { rows: convs } = await db.query(
    `select c.id from conversations c join conversation_members m on m.conversation_id = c.id
      where c.kind = 'event' and m.user_id = $1 limit 1`,
    [me],
  );
  const conv = convs[0]?.id;
  if (conv) {
    await db.query('delete from messages where conversation_id = $1', [conv]);
    await db.query('delete from polls where conversation_id = $1', [conv]);
    await db.query(`update conversations set event_id = $2, closes_at = null where id = $1`, [
      conv,
      board.id,
    ]);
    await db.query('delete from conversation_members where conversation_id = $1', [conv]);
    for (const n of board.going)
      await db.query(
        `insert into conversation_members (conversation_id, user_id, status) values ($1, $2, 'active')`,
        [conv, member[n].id],
      );
    let last = null;
    for (const [n, minutes, body] of CHAT) {
      const at = IST(20, 18, minutes);
      const { rows } = await db.query(
        `insert into messages (id, conversation_id, sender_id, kind, body, created_at)
         values (uuid_v7(), $1, $2, 'text', $3, $4) returning id`,
        [conv, member[n].id, body, at],
      );
      last = { id: rows[0].id, at };
    }
    await db.query(
      'update conversations set last_message_id = $2, last_message_at = $3 where id = $1',
      [conv, last.id, last.at],
    );
    await db.query(
      'update conversation_members set last_read_message_id = $2, last_read_at = $3 where conversation_id = $1 and user_id = $4',
      [conv, last.id, last.at, me],
    );
  }

  // Direct chats: one line each, earlier the same evening.
  for (const [n, body] of Object.entries(DIRECT)) {
    const { rows } = await db.query(
      `select c.id, c.last_message_id from conversations c
         join conversation_members a on a.conversation_id = c.id and a.user_id = $1
         join conversation_members b on b.conversation_id = c.id and b.user_id = $2
        where c.kind = 'direct' limit 1`,
      [me, member[n].id],
    );
    const direct = rows[0];
    if (!direct?.last_message_id) continue;
    const at = IST(20, 17, n === '1' ? 12 : 48);
    await db.query(`update messages set body = $2, sender_id = $3, created_at = $4 where id = $1`, [
      direct.last_message_id,
      body,
      member[n].id,
      at,
    ]);
    await db.query('update conversations set last_message_at = $2 where id = $1', [direct.id, at]);
  }
  await db.query('commit');
  console.log(`demo state ready: ${PLANS.length} plans, ${Object.keys(FACES).length} faces`);
} catch (error) {
  await db.query('rollback');
  throw error;
} finally {
  await db.end();
}
