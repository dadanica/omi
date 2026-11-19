"""Persist personal organizers and records for the prototype's shared space."""
import base64
import re
from datetime import date
from uuid import uuid4

from server import Fault


PRIVATE_KINDS = {'reminders', 'ideas'}
SHARED_KINDS = {'events', 'wishes', 'profiles', 'quotes', 'voices'}


def create_organizer_table(db):
    db.execute("""CREATE TABLE IF NOT EXISTS organizer (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        day TEXT NOT NULL DEFAULT '',
        annual INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        source TEXT REFERENCES messages(id),
        UNIQUE(kind, source)
    )""")
    if 'description' not in {r[1] for r in db.execute('PRAGMA table_info(organizer)')}:
        db.execute("ALTER TABLE organizer ADD COLUMN description TEXT NOT NULL DEFAULT ''")


    if 'room' not in {r[1] for r in db.execute('PRAGMA table_info(organizer)')}:
        db.execute("ALTER TABLE organizer ADD COLUMN room TEXT NOT NULL DEFAULT 'shared'")


def read_items(db, user, kind, room='shared'):
    if kind == 'quotes':
        rows = db.execute("""SELECT o.id, o.owner, m.id AS source, m.body AS text,
                   m.sender, t.created_at
            FROM organizer o JOIN messages m ON m.id=o.source
            LEFT JOIN message_meta t ON t.id=m.id
            WHERE o.kind='quotes' AND m.space_id=? AND m.deleted=0
            ORDER BY o.rowid DESC""",(room,))
    elif kind in PRIVATE_KINDS:
        rows = db.execute('SELECT * FROM organizer WHERE kind=? AND owner=? ORDER BY rowid DESC', (kind, user))
    else:
        rows = db.execute('SELECT * FROM organizer WHERE kind=? AND room=? ORDER BY rowid DESC', (kind,room))
    return [dict(row) for row in rows]


def organizer_request(db, user, method, path, data, permitted,room='shared'):
    parts = path.split('/')[3:]
    kind = parts[0]
    if len(parts) > 2 or kind not in PRIVATE_KINDS | SHARED_KINDS:
        raise Fault(404, '记录类别不存在')
    if kind in SHARED_KINDS and not permitted(db, user, room):
        raise Fault(404, '共同空间不可用')
    item_id = parts[1] if len(parts) == 2 else None
    if not item_id and method == 'GET':
        return {'items': read_items(db, user, kind,room)}
    if item_id and method in ('PATCH', 'DELETE'):
        existing = db.execute('SELECT id FROM organizer WHERE id=? AND kind=? AND owner=? AND room=?',
                              (item_id, kind, user,room)).fetchone()
        if not existing:
            raise Fault(404, '记录不存在或不可编辑')
        if method == 'DELETE' and kind != 'profiles':
            db.execute('DELETE FROM organizer WHERE id=?', (item_id,))
            return {'id': item_id}
        if method == 'PATCH' and kind == 'reminders' and isinstance(data.get('done'), bool):
            db.execute('UPDATE organizer SET done=? WHERE id=?', (data['done'], item_id))
            return {'id': item_id}
        raise Fault(400, '此记录不支持该操作')
    if item_id or method != 'POST':
        raise Fault(404, '记录入口不存在')

    if kind == 'quotes':
        source = data.get('source')
        if not isinstance(source, str) or not db.execute(
            "SELECT 1 FROM messages WHERE id=? AND space_id=? AND deleted=0", (source,room)
        ).fetchone():
            raise Fault(404, '这句话不在共同空间或已删除')
        db.execute("INSERT OR IGNORE INTO organizer(id, owner, kind, source,room) VALUES (?, ?, 'quotes', ?,?)",
                   (uuid4().hex, user, source,room))
        return {'id': db.execute("SELECT id FROM organizer WHERE kind='quotes' AND source=?", (source,)).fetchone()[0]}

    text = data.get('text')
    limit = {'profiles': 1200, 'ideas': 500}.get(kind, 160)
    if not isinstance(text, str) or len(text.strip()) > limit or (not text.strip() and kind != 'profiles'):
        raise Fault(400, '请输入有效内容')
    day = data.get('day', '')
    if not isinstance(day, str) or (day and kind not in {'events', 'wishes', 'reminders'}):
        raise Fault(400, '日期无效')
    if day or kind == 'events':
        try:
            if date.fromisoformat(day).isoformat() != day:
                raise ValueError
        except ValueError:
            raise Fault(400, '请选择有效日期')
    if kind == 'reminders' and db.execute(
        "SELECT COUNT(*) FROM organizer WHERE kind='reminders' AND owner=?", (user,)
    ).fetchone()[0] >= 10:
        raise Fault(409, '提醒事项最多保留 10 条，请先移除一条')
    if kind == 'profiles':
        item_id = 'profile:' + user + ('' if room=='shared' else ':'+room)
        db.execute("""INSERT INTO organizer(id, owner, kind, text,room) VALUES (?, ?, ?, ?,?)
                     ON CONFLICT(id) DO UPDATE SET text=excluded.text""", (item_id, user, kind, text.strip(),room))
    else:
        item_id = uuid4().hex
        annual = kind == 'events' and data.get('annual') is True
        description = data.get('description', '') if kind == 'events' else ''
        if not isinstance(description, str) or len(description) > 500:
            raise Fault(400, '简介最多 500 字')
        if kind == 'voices':
            description = data.get('description')
            match = isinstance(description, str) and re.fullmatch(r'data:audio/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)', description)
            if not match:
                raise Fault(400, '请选择音频文件')
            try:
                size = len(base64.b64decode(match[1], validate=True))
            except ValueError:
                raise Fault(400, '语音文件无效')
            if not 0 < size <= 2 * 1024 * 1024:
                raise Fault(400, '请选择 2 MB 以内的语音')
        db.execute('INSERT INTO organizer(id, owner, kind, text, day, annual, description,room) VALUES (?, ?, ?, ?, ?, ?, ?,?)',
                   (item_id, user, kind, text.strip(), day, annual, description.strip(),room))
    return {'id': item_id}
