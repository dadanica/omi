"""Add an idempotent set of fictional records to the local omi preview."""
import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from app import Prototype


HERE = Path(__file__).resolve().parent
PREFIX = 'showcase:'


def seed(db_path):
    app = Prototype(db_path)
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()

    reminders = [
        ('完成电商训练营周报', 0, False),
        ('整理视觉产线素材', 1, False),
        ('江西行程确认与预订', 3, False),
        ('英语单词打卡（30 个）', None, False),
        ('提交 omi 小程序体验反馈', 2, False),
        ('给妈妈回电话', 0, True),
        ('更新作品集介绍', None, False),
        ('整理本周读书笔记', 5, False),
    ]
    ideas = [
        '把共同经历做成一颗可以打开的时间胶囊',
        '关系可视化可以试试星云和泡泡球',
        '用标签整理学习、生活和创作灵感',
        '为 omi 设计一个轻轻的晚安问候',
        '重要日程靠近时，加入柔和的呼吸动画',
        '愿望卡片里可以慢慢积累旅行照片',
        '把年度回顾做成两个人的故事书',
        '做一张只记录快乐小事的月历',
    ]
    events = [
        ('秋日手作市集', 2, False),
        ('我们认识纪念日', 3, True),
        ('桐桐的生日', 9, True),
        ('一起去看插画展', 11, False),
    ]
    wishes = [
        ('一起去海边看一次日出', 7),
        ('去看期待很久的舞台剧', 12),
        ('一起去日本看樱花', None),
        ('找一个没有光污染的地方看星星', None),
        ('周末学做一款新甜点', None),
        ('共同整理一册旅行相簿', None),
    ]
    profiles = {
        'A': '喜欢安静的小书店、桂花乌龙和自然光。\n礼物偏好手写卡片、小众香氛和有故事的旧物。\n旅行时喜欢留出空白，不把行程排得太满。',
        'B': '喜欢散步、看展和收集有趣的杯子。\n爱吃微辣的食物，也喜欢带坚果的甜点。\n比起突然的惊喜，更喜欢提前商量好的安排。',
    }

    chat_rows = [
        ('showcase:quote-1', 'B', '你不用每次都那么坚强，累的时候也可以先靠一会儿。', -18),
        ('showcase:quote-2', 'A', '和你一起经历的普通一天，也会变成我愿意反复想起的日子。', -12),
        ('showcase:quote-3', 'B', '我们可以慢一点，把彼此真正想说的话听完。', -6),
        (
            'showcase:plan-1',
            'A',
            f'{(today + timedelta(days=4)).month}月{(today + timedelta(days=4)).day}日一起去看新开的插画展吧，我已经把下午留出来了。',
            -2,
        ),
        (
            'showcase:plan-2',
            'B',
            f'{(today + timedelta(days=10)).month}月{(today + timedelta(days=10)).day}日晚上一起参加朋友的生日聚会，记得提前出发。',
            -1,
        ),
    ]
    assistant_rows = [
        ('showcase:omi-1', '我最近想把工作和生活重新排一排，但还没有找到舒服的节奏。', -4),
        ('showcase:omi-2', '如果我在关系里感到不安，怎样表达会更诚实也更温和？', -1),
    ]

    with app.db() as db:
        for index, (text, offset, done) in enumerate(reminders):
            day = '' if offset is None else (today + timedelta(days=offset)).isoformat()
            db.execute(
                """INSERT INTO organizer(id, owner, kind, text, day, done)
                   VALUES (?, 'A', 'reminders', ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET text=excluded.text, day=excluded.day, done=excluded.done""",
                (f'{PREFIX}reminder:{index}', text, day, done),
            )
        for index, text in enumerate(ideas):
            db.execute(
                """INSERT INTO organizer(id, owner, kind, text)
                   VALUES (?, 'A', 'ideas', ?)
                   ON CONFLICT(id) DO UPDATE SET text=excluded.text""",
                (f'{PREFIX}idea:{index}', text),
            )
        for index, (text, offset, annual) in enumerate(events):
            day = (today + timedelta(days=offset)).isoformat()
            db.execute(
                """INSERT INTO organizer(id, owner, kind, text, day, annual)
                   VALUES (?, 'A', 'events', ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET text=excluded.text, day=excluded.day, annual=excluded.annual""",
                (f'{PREFIX}event:{index}', text, day, annual),
            )
        for index, (text, offset) in enumerate(wishes):
            day = '' if offset is None else (today + timedelta(days=offset)).isoformat()
            db.execute(
                """INSERT INTO organizer(id, owner, kind, text, day)
                   VALUES (?, 'A', 'wishes', ?, ?)
                   ON CONFLICT(id) DO UPDATE SET text=excluded.text, day=excluded.day""",
                (f'{PREFIX}wish:{index}', text, day),
            )
        for owner, text in profiles.items():
            db.execute(
                """INSERT INTO organizer(id, owner, kind, text)
                   VALUES (?, ?, 'profiles', ?)
                   ON CONFLICT(id) DO UPDATE SET text=excluded.text""",
                ('profile:' + owner, owner, text),
            )

        for item_id, sender, body, offset in chat_rows:
            db.execute(
                """INSERT INTO messages(id, space_id, sender, body)
                   VALUES (?, 'shared', ?, ?)
                   ON CONFLICT(id) DO UPDATE SET sender=excluded.sender, body=excluded.body, deleted=0, version=messages.version+1""",
                (item_id, sender, body),
            )
            created = datetime.combine(today + timedelta(days=offset), datetime.min.time(), ZoneInfo('Asia/Shanghai')).replace(hour=19)
            db.execute(
                """INSERT INTO message_meta(id, created_at, tags) VALUES (?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, tags=excluded.tags""",
                (item_id, created.isoformat(), json.dumps(['共同经历'], ensure_ascii=False)),
            )
            memory_id = 'memory:' + item_id
            db.execute(
                """INSERT INTO memories(id, space_id, body, valid) VALUES (?, 'shared', ?, 1)
                   ON CONFLICT(id) DO UPDATE SET body=excluded.body, valid=1""",
                (memory_id, body),
            )
            version = db.execute('SELECT version FROM messages WHERE id=?', (item_id,)).fetchone()[0]
            db.execute(
                """INSERT INTO sources(memory_id, message_id, source_version) VALUES (?, ?, ?)
                   ON CONFLICT(memory_id, message_id) DO UPDATE SET source_version=excluded.source_version""",
                (memory_id, item_id, version),
            )
            db.execute(
                """INSERT INTO search_index(memory_id, text) VALUES (?, ?)
                   ON CONFLICT(memory_id) DO UPDATE SET text=excluded.text""",
                (memory_id, body.lower()),
            )

        for index, (item_id, _, _, _) in enumerate(chat_rows[:3]):
            db.execute(
                """INSERT INTO organizer(id, owner, kind, source)
                   VALUES (?, 'A', 'quotes', ?)
                   ON CONFLICT(id) DO UPDATE SET source=excluded.source""",
                (f'{PREFIX}quote:{index}', item_id),
            )

        for item_id, body, offset in assistant_rows:
            db.execute(
                """INSERT INTO messages(id, space_id, sender, body)
                   VALUES (?, 'assistant:A', 'A', ?)
                   ON CONFLICT(id) DO UPDATE SET body=excluded.body, deleted=0, version=messages.version+1""",
                (item_id, body),
            )
            created = datetime.combine(today + timedelta(days=offset), datetime.min.time(), ZoneInfo('Asia/Shanghai')).replace(hour=21)
            db.execute(
                """INSERT INTO message_meta(id, created_at, tags) VALUES (?, ?, '["自我探索"]')
                   ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, tags=excluded.tags""",
                (item_id, created.isoformat()),
            )

    return {
        'reminders': len(reminders),
        'ideas': len(ideas),
        'events': len(events),
        'wishes': len(wishes),
        'profiles': len(profiles),
        'quotes': 3,
        'recent_chat_plans': 2,
        'omi_private_messages': len(assistant_rows),
    }


def seed_preference_examples(db_path):
    app = Prototype(db_path)
    examples = [
        ('A','2026-10-14','我一直喜欢旅行，出发前会先把路线安排好。'),
        ('B','2026-10-15','我也喜欢旅行，到了当地更喜欢随意走走。'),
        ('A','2026-10-21','我喜欢桂花乌龙，清淡一点就很好。'),
        ('B','2026-10-24','我最近很喜欢摄影，正在试着拍街边的光影。'),
        ('A','2026-10-27','我想去京都看一次秋天的红叶。'),
        ('B','2026-10-30','我喜欢提前商量，留点时间想一想再答复。')]
    with app.db() as db:
        for index,(owner,day,body) in enumerate(examples):
            mid='showcase:preference:'+str(index)
            inserted=db.execute("INSERT OR IGNORE INTO messages(id,space_id,sender,body) VALUES (?,'shared',?,?)",
                                (mid,owner,body)).rowcount
            if inserted:
                db.execute("INSERT INTO message_meta VALUES (?,?,?)",(mid,day+'T19:00:00+08:00','["偏好样例"]'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default=str(HERE / 'runtime' / 'preview.sqlite'))
    args = parser.parse_args()
    print(json.dumps(seed(args.db), ensure_ascii=False, indent=2))
    seed_preference_examples(args.db)
