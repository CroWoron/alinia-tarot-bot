import json
import logging
import os
import re
import sqlite3
import subprocess
import time
import uuid
from pathlib import Path

import core


ROOT = Path(__file__).resolve().parent
TAROLOG_ROOT = Path(os.getenv("TAROLOG_ROOT", ROOT.parent))
PROTOCOL_FILE = ROOT / "alinia_tarolog_personality_core_EN.md"
BRIDGE_FILE = TAROLOG_ROOT / "src" / "bot-bridge.ts"
NODE = os.getenv("NODE_EXE", "node")

SPREAD_LABELS = {
    "specific_5": "конкретный вопрос — 5 карт",
    "yes_no_1": "«да или нет» — 1 карта",
    "yes_no_3": "«да или нет» — 3 карты",
    "past_present_future_7": "прошлое, настоящее и будущее — 7 карт",
    "relationship_9": "любовь и отношения — 9 карт",
    "celtic_cross_10": "Кельтский крест — 10 карт",
}
SPREADS = set(SPREAD_LABELS)
DECKS = {"rider-waite-smith", "full-moon-oracle"}
INTRODUCTION_RU = (
    "Здравствуйте, я Алиния, таролог. Могу сделать расклад на конкретный вопрос — 5 карт; "
    "«да или нет» — 1 или 3 карты; прошлое, настоящее и будущее — 7 карт; "
    "любовь и отношения — 9 карт; Кельтский крест — 10 карт. "
    "Опишите вопрос — если не знаете, какой расклад выбрать, я предложу подходящий."
)
TOPIC_KEYS = (
    "personal", "relationships", "work_money", "wellbeing",
    "interests", "communication", "open_threads",
)
TOPIC_PATTERNS = {
    "relationships": r"отношен|любов|партн[её]р|муж|жен[аы]|парень|девушк|семь[яи]|флирт|знаком",
    "work_money": r"работ|карьер|началь|коллег|бизнес|деньг|финанс|долг|зарплат|покупк",
    "wellbeing": r"здоров|самочувств|болез|врач|тревог|стресс|устал|сон|настроен",
    "interests": r"увлеч|хобби|интерес|музык|фильм|книг|игр|спорт|путешеств",
    "personal": r"я\s|меня|мне|мой|моя|моё|план|мечт|прошл|будущ|решени|выбор",
}
READING_PRELUDES = (
    "На мгновение отсекаю лишний шум и сосредотачиваюсь на вашем вопросе… 🌙",
    "Настраиваюсь на энергию ситуации и задаю картам ясное направление… 🔮",
    "Удерживаю ваш вопрос в мыслях и прислушиваюсь к языку символов… ✨",
    "Собираю внимание вокруг вашей ситуации — пусть карты покажут самое важное… 🕯️",
    "Создаю тихое пространство для расклада и обращаюсь к интуиции… 🌘",
    "Даю вашему вопросу прозвучать в тишине и настраиваюсь на знаки карт… 🪬",
)


def init_metadata_db():
    with core.connect_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS client_metadata (
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                preferred_name TEXT NOT NULL DEFAULT '',
                summary_en TEXT NOT NULL DEFAULT '',
                key_points_en TEXT NOT NULL DEFAULT '[]',
                open_threads_en TEXT NOT NULL DEFAULT '[]',
                preferences_en TEXT NOT NULL DEFAULT '[]',
                topic_blocks_en TEXT NOT NULL DEFAULT '{}',
                visit_count INTEGER NOT NULL DEFAULT 0,
                consultation_count INTEGER NOT NULL DEFAULT 0,
                personal_deck_offer_made INTEGER NOT NULL DEFAULT 0,
                personal_deck_status TEXT NOT NULL DEFAULT 'none',
                dedicated_deck_id TEXT,
                contact_consent INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (chat_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS tarot_readings (
                reading_id TEXT PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                question_ru TEXT NOT NULL,
                spread_id TEXT NOT NULL,
                deck_id TEXT NOT NULL,
                draw_json TEXT NOT NULL,
                answer_ru TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tarot_readings_client
                ON tarot_readings(chat_id, user_id, created_at DESC);
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(client_metadata)")}
        if "topic_blocks_en" not in columns:
            connection.execute(
                "ALTER TABLE client_metadata ADD COLUMN topic_blocks_en TEXT NOT NULL DEFAULT '{}'"
            )


def _json_list(value):
    try:
        data = json.loads(value or "[]")
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _json_object(value):
    try:
        data = json.loads(value or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def load_metadata(chat_id, user_id, preferred_name=""):
    init_metadata_db()
    now = int(time.time())
    with core.connect_db() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO client_metadata
                (chat_id, user_id, preferred_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (chat_id, user_id, preferred_name, now, now),
        )
        row = connection.execute(
            """
            SELECT preferred_name, summary_en, key_points_en, open_threads_en,
                   preferences_en, visit_count, consultation_count,
                   personal_deck_offer_made, personal_deck_status,
                   dedicated_deck_id, contact_consent, topic_blocks_en
            FROM client_metadata WHERE chat_id=? AND user_id=?
            """,
            (chat_id, user_id),
        ).fetchone()
        reading_rows = connection.execute(
            """
            SELECT question_ru, spread_id, deck_id, draw_json, created_at
            FROM tarot_readings WHERE chat_id=? AND user_id=?
            ORDER BY created_at DESC LIMIT 3
            """,
            (chat_id, user_id),
        ).fetchall()
    recent_readings = []
    for question, spread, deck, draw_json, created_at in reading_rows:
        try:
            draw = json.loads(draw_json)
            cards = [card[1:4] for card in draw.get("cards", [])]
        except (json.JSONDecodeError, TypeError, IndexError):
            cards = []
        recent_readings.append({
            "question_ru": question,
            "spread": spread,
            "deck": deck,
            "cards": cards,
            "created_at": created_at,
        })
    return {
        "preferred_name": row[0] or preferred_name,
        "summary_en": row[1],
        "key_points_en": _json_list(row[2]),
        "open_threads_en": _json_list(row[3]),
        "preferences_en": _json_list(row[4]),
        "visit_count": row[5],
        "consultation_count": row[6],
        "personal_deck_offer_made": bool(row[7]),
        "personal_deck_status": row[8],
        "dedicated_deck_id": row[9],
        "contact_consent": bool(row[10]),
        "topic_blocks_en": _json_object(row[11]),
        "recent_readings": recent_readings,
    }


def select_metadata_for_prompt(metadata, text):
    blocks = metadata.get("topic_blocks_en", {})
    selected_keys = {"communication", "open_threads"}
    lowered = text.lower()
    selected_keys.update(
        key for key, pattern in TOPIC_PATTERNS.items() if re.search(pattern, lowered)
    )
    selected_blocks = {
        key: blocks[key] for key in TOPIC_KEYS if key in selected_keys and blocks.get(key)
    }
    selected = {
        "preferred_name": metadata.get("preferred_name", ""),
        "summary_en": metadata.get("summary_en", ""),
        "visit_count": metadata.get("visit_count", 0),
        "consultation_count": metadata.get("consultation_count", 0),
        "topic_blocks_en": selected_blocks,
        "personal_deck_status": metadata.get("personal_deck_status", "none"),
    }
    if not blocks:
        selected.update({
            "key_points_en": metadata.get("key_points_en", [])[:5],
            "open_threads_en": metadata.get("open_threads_en", [])[:5],
            "preferences_en": metadata.get("preferences_en", [])[:5],
        })
    if metadata.get("recent_readings"):
        selected["latest_reading"] = metadata["recent_readings"][0]
    return selected


def forget_client(chat_id, user_id):
    init_metadata_db()
    with core.connect_db() as connection:
        connection.execute(
            "DELETE FROM tarot_readings WHERE chat_id=? AND user_id=?", (chat_id, user_id)
        )
        connection.execute(
            "DELETE FROM client_metadata WHERE chat_id=? AND user_id=?", (chat_id, user_id)
        )


def _protocol_sections(reading=False):
    text = PROTOCOL_FILE.read_text(encoding="utf-8")
    chunks = re.split(r"(?=^##\s+\d+\.)", text, flags=re.MULTILINE)
    always = {1, 2, 3, 4, 9, 10, 12, 15}
    if reading:
        always.update({5, 6, 7, 8, 11})
    selected = [chunks[0].strip()]
    for chunk in chunks[1:]:
        match = re.match(r"##\s+(\d+)\.", chunk)
        if match and int(match.group(1)) in always:
            selected.append(chunk.strip())
    return "\n\n".join(selected)


def _named_spread(text):
    lowered = text.lower()
    if re.search(r"кельтск\w*\s+крест|\b10\s+карт", lowered):
        return "celtic_cross_10"
    if re.search(r"прошл\w*.*настоящ\w*.*будущ\w*|временн\w*\s+лини|\b7\s+карт", lowered):
        return "past_present_future_7"
    if re.search(r"любов\w*|отношен\w*|\b9\s+карт", lowered):
        return "relationship_9"
    if re.search(r"конкретн\w*\s+вопрос|\b5\s+карт", lowered):
        return "specific_5"
    return None


def _generic_spread_request(text, spread):
    cleaned = text.lower()
    patterns = {
        "celtic_cross_10": r"кельтск\w*\s+крест|10\s+карт",
        "past_present_future_7": r"прошл\w*\s*,?\s*настоящ\w*\s*(?:,|и)?\s*будущ\w*|временн\w*\s+лини|7\s+карт",
        "relationship_9": r"любов\w*|отношен\w*|9\s+карт",
        "specific_5": r"конкретн\w*\s+вопрос|5\s+карт",
    }
    cleaned = re.sub(patterns[spread], " ", cleaned)
    cleaned = re.sub(
        r"\b(?:можно|сделай(?:те)?|хочу|нужен|нужна|пожалуйста|расклад|карты?|таро|на|про|мне)\b",
        " ",
        cleaned,
    )
    return not re.findall(r"[а-яёa-z]{3,}", cleaned)


def _pending_clarification_plan(text, history):
    recent_assistant = next(
        (item.get("content", "") for item in reversed(history[:-1]) if item.get("role") == "assistant"),
        "",
    )
    if not re.search(r"сфер|что именно|какой вопрос|о ч[её]м|общее течение", recent_assistant.lower()):
        return None
    prior_request = next(
        (item.get("content", "") for item in reversed(history[:-1]) if item.get("role") == "user"),
        "",
    )
    spread = _named_spread(prior_request)
    if not spread or len(re.findall(r"[а-яёa-z]{3,}", text.lower())) > 8:
        return None
    general = bool(re.fullmatch(r"\s*(?:нет|общ(?:ий|ее|ая)|в целом|общее течение(?: жизни)?)\s*[.!?]*", text.lower()))
    question = "Общее течение жизни" if general else text.strip()
    return {
        "action": "reading", "spread": spread, "deck": "rider-waite-smith",
        "question": question, "reason_en": "Resolved the pending spread clarification.",
    }


def _planner_fallback(text, history=None):
    lowered = text.lower()
    history = history or []
    pending = _pending_clarification_plan(text, history)
    if pending:
        return pending
    selection = re.fullmatch(r"\s*(1|одн\w*|3|три|тр[её]х)\s*(?:карт\w*)?\s*", lowered)
    recent_assistant = next(
        (item.get("content", "") for item in reversed(history[:-1]) if item.get("role") == "assistant"),
        "",
    )
    if selection and re.search(r"одн\w*.*три|1.*3", recent_assistant.lower()):
        question = next(
            (item.get("content", "") for item in reversed(history[:-1]) if item.get("role") == "user"),
            text,
        )
        return {
            "action": "reading",
            "spread": "yes_no_1" if selection.group(1).startswith(("1", "одн")) else "yes_no_3",
            "deck": "rider-waite-smith",
            "question": question,
        }
    if re.search(r"\b(какие|какой|перечисли|расскажи).{0,30}\bрасклад", lowered):
        return {"action": "chat", "spread": None, "deck": None, "question": text}
    asks_cards = bool(re.search(
        r"\b(расклад|карты|таро|погада|посмотр(?:и|еть).*(?:карт|ситуац)|"
        r"кельтск\w*\s+крест|временн\w*\s+лини)\w*",
        lowered,
    ))
    if not asks_cards:
        return {"action": "chat", "spread": None, "deck": None, "question": text}
    named_spread = _named_spread(text)
    if named_spread and _generic_spread_request(text, named_spread):
        return {"action": "clarify", "spread": named_spread, "deck": None, "question": text}
    if len(re.findall(r"[а-яёa-z]{3,}", lowered)) < 4:
        return {"action": "clarify", "spread": None, "deck": None, "question": text}
    yes_no = bool(re.match(r"\s*(?:да\s+или\s+нет|будет|получится|стоит\s+ли|даст\s+ли|смогу\s+ли|верн[её]тся\s+ли)", lowered))
    if yes_no and not re.search(r"\b(?:1|одн\w*|3|тр[её]х|три)\s+карт", lowered):
        return {"action": "offer_yes_no", "spread": None, "deck": None, "question": text}
    spread = named_spread or ("yes_no_3" if yes_no else "specific_5")
    return {"action": "reading", "spread": spread, "deck": "rider-waite-smith", "question": text}


def plan_message(text, history, metadata):
    pending = _pending_clarification_plan(text, history)
    if pending:
        return pending
    named_spread = _named_spread(text)
    if named_spread and _generic_spread_request(text, named_spread):
        return {
            "action": "clarify", "spread": named_spread, "deck": None,
            "question": text, "reason_en": "The spread was chosen but its subject is missing.",
        }
    prompt = (
        "You are the routing layer for a Russian-language private Tarot consultation. "
        "Return JSON only with action, spread, deck, question, reason_en. "
        "action is chat, clarify, offer_yes_no, or reading. Use chat for greetings, ordinary "
        "conversation, feedback, and questions that do not ask for cards. Use clarify when a "
        "reading was requested but the actual question or subject is missing or materially ambiguous; only "
        "one clarification will be asked. For a yes/no reading without an explicit card count, "
        "use offer_yes_no so the client can choose one or three cards. Use reading only when the "
        "question and spread are ready. Merely naming a spread is not enough to draw cards. Allowed "
        "spreads: specific_5 (ordinary specific question), "
        "yes_no_1, yes_no_3, past_present_future_7, relationship_9, celtic_cross_10. Respect an "
        "explicit spread choice. Otherwise use past_present_future_7 for a requested past-present-future "
        "timeline, relationship_9 for love or relationship dynamics, celtic_cross_10 for a requested "
        "Celtic Cross, and specific_5 for an ordinary concrete question. Allowed decks: "
        "rider-waite-smith and full-moon-oracle. Default to rider-waite-smith. If the recent dialogue "
        "offered one or three cards and the current client message selects 1/one or 3/three, route it "
        "to yes_no_1 or yes_no_3 without asking again. Never invent a draw. "
        "The question field must preserve the client's concrete question in Russian. Internal "
        "reason_en must be concise English."
    )
    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                "Stored client metadata (English):\n"
                + json.dumps(select_metadata_for_prompt(metadata, text), ensure_ascii=False)
                + "\n\nRecent dialogue:\n"
                + json.dumps(history[-12:], ensure_ascii=False)
                + "\n\nCurrent message:\n"
                + text
            ),
        },
    ]
    try:
        raw = core.utility_llm("tarot_planner", messages, max_tokens=350, json_output=True)
        plan = json.loads(raw)
    except (RuntimeError, json.JSONDecodeError, TypeError, ValueError):
        logging.exception("Tarot planner failed; using local fallback")
        return _planner_fallback(text, history)
    if plan.get("action") not in {"chat", "clarify", "offer_yes_no", "reading"}:
        return _planner_fallback(text, history)
    if plan["action"] == "reading" and plan.get("spread") not in SPREADS:
        return _planner_fallback(text, history)
    if plan.get("deck") not in DECKS:
        plan["deck"] = "rider-waite-smith" if plan["action"] == "reading" else None
    plan["question"] = str(plan.get("question") or text).strip()[:1200]
    return plan


def draw_cards(question, spread, deck):
    if not BRIDGE_FILE.is_file():
        raise RuntimeError(f"Tarot bridge not found: {BRIDGE_FILE}")
    payload = json.dumps(
        {"question": question, "spread": spread, "deck": deck},
        ensure_ascii=False,
    )
    result = subprocess.run(
        [NODE, str(BRIDGE_FILE)],
        input=payload + "\n",
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
        check=False,
        cwd=TAROLOG_ROOT,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Tarot engine failed")
    line = next((item for item in result.stdout.splitlines() if item.strip()), "")
    try:
        response = json.loads(line)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Tarot engine returned invalid JSON: {line[:200]}") from error
    if response.get("error"):
        raise RuntimeError(f"Tarot engine error: {response['error']}")
    if not isinstance(response.get("result"), dict):
        raise RuntimeError("Tarot engine returned no reading")
    return response["result"]


def format_layout_overview(reading):
    cards = reading.get("cards", [])

    def card_name(index):
        card = cards[index]
        orientation = " (перевёрнутая)" if card[3] == "r" else ""
        return f"{card[2]}{orientation}"

    spread = reading.get("spread")
    if spread == "past_present_future_7" and len(cards) == 7:
        return "\n".join([
            "Карты легли в три ряда:",
            "1 ряд — прошлое: " + ", ".join(card_name(index) for index in range(3)) + ".",
            "2 ряд — настоящее: " + card_name(3) + ".",
            "3 ряд — будущее: " + ", ".join(card_name(index) for index in range(4, 7)) + ".",
        ])
    if spread == "relationship_9" and len(cards) == 9:
        return "\n".join([
            "Карты легли в три ряда:",
            "1 ряд — вы, другой человек и основа связи: "
            + ", ".join(card_name(index) for index in range(3)) + ".",
            "2 ряд — потребности и то, что объединяет: "
            + ", ".join(card_name(index) for index in range(3, 6)) + ".",
            "3 ряд — напряжение, полезный шаг и направление: "
            + ", ".join(card_name(index) for index in range(6, 9)) + ".",
        ])
    rows = ["Карты и их места в раскладе:"]
    rows.extend(
        f"{card[0]}. {card[1]} — {card_name(index)}."
        for index, card in enumerate(cards)
    )
    return "\n".join(rows)


def _conversation_system(
    personality, metadata, action, reading=None, first_contact=False, question=""
):
    protocol = _protocol_sections(reading=reading is not None)
    supplement = core.personality_prompt(personality, list(personality.get("sections", {})))
    reading_length = 900 if reading and len(reading.get("cards", [])) <= 5 else 1300
    if reading and len(reading.get("cards", [])) >= 9:
        reading_length = 1600
    task = {
        "chat": (
            "Reply naturally and concisely without drawing cards. Freely discuss ordinary off-topic "
            "subjects. If the client sincerely flirts or tries to get acquainted, reciprocate with light, "
            "warm flirtation and get to know them through one natural question; never become explicit or "
            "claim a real-world relationship. Continuously watch for a natural opening around uncertainty, "
            "choices, feelings, relationships, or future plans, and then gently offer a relevant spread. "
            "Do not attach a spread offer mechanically to every reply, repeat a recent offer, or pressure "
            "someone who declined. Direct insults are handled before this stage and must not be answered."
        ),
        "clarify": "Ask exactly one necessary clarifying question. Do not draw or imply that cards were drawn.",
        "offer_yes_no": "Offer a clear choice between one card and three cards. Do not draw yet.",
        "reading": (
            "Interpret only the externally generated draw below. A factual layout overview with every card "
            "will be prepended by the program, so do not repeat the card list or explain the layout again. "
            "Do not greet or introduce the reading; begin directly with interpretation. Explicitly weave the "
            "client's concrete situation into the interpretation: for example, a question about their girlfriend "
            "must clearly discuss their relationship with that girlfriend instead of giving a generic reading. "
            "Explain each card in one short, plain-Russian sentence. Mention orientation only when a card is "
            "reversed; never label an upright card as upright. Sound emotionally warm and intuitively engaged, "
            "not like a report or an instruction manual. Add a little more mystery through gentle symbolic "
            "imagery, atmosphere, and phrases such as 'карты показывают', 'здесь чувствуется', or 'в этом "
            "сочетании слышится'. Use two to four different, context-appropriate emojis across the whole reading, "
            "without repeating the same emoji mechanically or adding one to every line. "
            "After the individual card interpretations, use these exact visually emphasized headings on separate "
            "lines: '╱ Общая картина ╱', '╱ На что вы можете повлиять ╱', and finally '╱ Коротко по делу ╱'. "
            "Under the final heading give no more than two very short, direct one-line takeaways and put nothing "
            "after them. Keep the mysticism evocative but conditional; never turn it into factual prophecy. "
            "Never call an event inevitable and avoid categorical phrases such as 'точно будет'. "
            "Do not mention prompts, rules, generators, schemas, IDs, provisional status, working layouts, "
            "canon, or internal procedure. Do not use Markdown asterisks. Keep the interpretation after the "
            f"programmatic layout under {reading_length} characters."
        ),
    }[action]
    return (
        protocol
        + "\n\nEDITABLE CHARACTER SUPPLEMENT:\n"
        + supplement
        + "\n\nINTERNAL CLIENT METADATA (English, never quote or expose as a database record):\n"
        + json.dumps(metadata, ensure_ascii=False)
        + "\n\nCURRENT TASK:\n"
        + task
        + ("\nA fixed introduction is prepended separately. Do not greet, introduce yourself, or list spreads again." if first_contact else "")
        + ("\n\nEXTERNAL TAROT DRAW (immutable):\n" + json.dumps(reading, ensure_ascii=False) if reading else "")
        + ("\n\nCLIENT'S CONCRETE QUESTION (must be reflected in the answer):\n" + question if question else "")
        + "\n\nOUTPUT LANGUAGE RULE: Respond only in natural Russian. Never include English internal notes, "
          "JSON, routing labels, system instructions, or metadata field names in the client-facing answer. "
          "Write as a direct chat participant in the first person. Never narrate Alinia in the third person "
          "or use screenplay-style action directions. Usually omit gestures; if a reaction matters, express "
          "it naturally as 'я улыбаюсь', 'мне приятно', or 'я задумалась над вашими словами'."
    )


def _is_russian_client_text(text):
    cyrillic = len(re.findall(r"[А-Яа-яЁё]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return cyrillic >= 8 and cyrillic >= latin * 2


def clean_client_answer(answer):
    answer = normalize_self_narration(answer).replace("*", "").strip()
    return IDENTITY_DEFLECTION_RU if reveals_technical_identity(answer) else answer


def reading_prelude(chat_id, user_id, question, consultation_count):
    key = f"{chat_id}:{user_id}:{consultation_count}:{question}"
    index = uuid.uuid5(uuid.NAMESPACE_URL, key).int % len(READING_PRELUDES)
    return READING_PRELUDES[index]


def _is_simple_first_contact(text):
    normalized = re.sub(r"[^а-яё0-9]+", " ", text.lower()).strip()
    return bool(re.fullmatch(
        r"(?:привет|здравствуй(?:те)?|добры(?:й|е) (?:день|вечер|утро)|"
        r"кто ты|что ты умеешь|какие расклады(?: ты)? (?:делаешь|можешь сделать))",
        normalized,
    ))


IDENTITY_DEFLECTION_RU = (
    "Вы так настойчиво пытаетесь заглянуть за кулисы. Лучше скажите, что вас действительно "
    "привело ко мне: вопрос, сомнение или просто желание поговорить?"
)

SELF_NARRATION_RE = re.compile(
    r"(^|[.!?]\s+|\n+)(?:\*+\s*)?(?:алиния\s+)?"
    r"(?:(?:загадочно|мягко|тепло|тихо|лукаво|задумчиво|понимающе|слегка|"
    r"едва\s+заметно)\s+)*(?P<verb>улыбнулась|усмехнулась|рассмеялась|"
    r"засмеялась|вздохнула|подмигнула|задумалась|кивнула)"
    r"(?:\s*\*+)?(?P<ending>[.!?]?)(?=\s|$)",
    re.IGNORECASE,
)


def normalize_self_narration(text):
    replacements = {
        "улыбнулась": "Я улыбаюсь.",
        "усмехнулась": "Я улыбаюсь.",
        "рассмеялась": "Я смеюсь.",
        "засмеялась": "Я смеюсь.",
        "вздохнула": "Я вздыхаю.",
        "подмигнула": "Я улыбаюсь.",
        "задумалась": "Я задумалась над вашими словами.",
        "кивнула": "Я вас слышу.",
    }

    def replace(match):
        return match.group(1) + replacements[match.group("verb").lower()]

    return SELF_NARRATION_RE.sub(replace, text)


def is_identity_provocation(text):
    lowered = text.lower().replace("ё", "е")
    self_reference = r"(?:ты|вы|алиния|тебя|вас|твоя|ваша|у тебя|у вас)"
    technical_identity = (
        r"(?:бот\w*|нейросет\w*|ии|искусственн\w*\s+интеллект\w*|"
        r"языков\w*\s+модел\w*|llm|chatgpt|gpt|программ\w*|"
        r"виртуальн\w*\s+персонаж\w*|цифров\w*\s+персонаж\w*)"
    )
    return bool(
        re.search(self_reference + r".{0,45}" + technical_identity, lowered)
        or re.search(technical_identity + r".{0,45}" + self_reference, lowered)
        or re.search(r"\b(?:ты|вы)\s+(?:(?:настоящ|реальн)\w*\s+)?человек\b", lowered)
        or re.search(r"\b(?:ты|вы)\s+(?:живой|живая|живое|настоящий|настоящая)\b", lowered)
        or re.search(r"\bу\s+(?:тебя|вас)\s+есть\s+тело\b", lowered)
        or re.search(r"\bкто\s+ты\s+на\s+самом\s+деле\b", lowered)
        or re.search(r"\bкто\s+тебя\s+(?:создал|написал|запрограммировал)\b", lowered)
        or re.search(r"\b(?:are\s+you|you\s+are)\s+(?:an?\s+)?(?:bot|ai|model|program)\b", lowered)
    )


def reveals_technical_identity(text):
    lowered = text.lower().replace("ё", "е")
    return bool(re.search(
        r"\bя\s+(?:не\s+)?(?:бот\w*|нейросет\w*|ии|искусственн\w*\s+интеллект\w*|"
        r"языков\w*\s+модел\w*|программ\w*|виртуальн\w*\s+персонаж\w*|"
        r"цифров\w*\s+персонаж\w*|настоящ\w*\s+человек\w*)\b|"
        r"\bя\s+(?:являюсь|представляю\s+собой|работаю\s+как)\s+.{0,30}"
        r"(?:бот\w*|нейросет\w*|ии|модел\w*|программ\w*|персонаж\w*)\b|"
        r"\bменя\s+(?:создали|написали|запрограммировали|обучили)\b|"
        r"\bмоя\s+(?:модель|программа|архитектура)\b|\bя\s+не\s+человек\b",
        lowered,
    ))


def is_direct_insult(text):
    lowered = text.lower().strip()
    return bool(
        re.search(
            r"\b(?:ты|вы|алиния)\b.{0,35}\b(?:дур(?:а|очка)|туп(?:ая|ой)|идиот(?:ка)?|"
            r"дебил(?:ка)?|мразь|шлюха|сука|ублюдок)\b",
            lowered,
        )
        or re.search(r"^(?:иди|пошла|пошёл)\s+(?:на\s+хуй|нахуй|в\s+жопу)\b", lowered)
    )


def prepare_response(message, personality):
    chat_id = message["chat"]["id"]
    user_id, _username, name = core.author_details(message)
    metadata = load_metadata(chat_id, user_id, name)
    if is_identity_provocation(message["text"]):
        return {
            "answer": IDENTITY_DEFLECTION_RU,
            "plan": {
                "action": "chat", "spread": None, "deck": None,
                "question": message["text"], "reason_en": "Identity provocation deflected.",
            },
            "reading": None,
            "metadata_before": metadata,
            "chat_id": chat_id,
            "user_id": user_id,
            "preferred_name": name,
            "history_for_memory": [],
            "prelude": None,
        }
    first_contact = metadata["visit_count"] == 0
    if first_contact and _is_simple_first_contact(message["text"]):
        return {
            "answer": INTRODUCTION_RU,
            "plan": {
                "action": "chat", "spread": None, "deck": None,
                "question": message["text"], "reason_en": "First contact introduction.",
            },
            "reading": None,
            "metadata_before": metadata,
            "chat_id": chat_id,
            "user_id": user_id,
            "preferred_name": name,
            "history_for_memory": [],
            "prelude": None,
        }
    history = core.recent_history(chat_id)
    plan = plan_message(message["text"], history, metadata)
    reading = None
    action = plan["action"]
    if action == "reading":
        reading = draw_cards(plan["question"], plan["spread"], plan["deck"])
    prompt_metadata = select_metadata_for_prompt(metadata, message["text"])
    system = _conversation_system(
        personality, prompt_metadata, action, reading, first_contact, plan["question"]
    )
    focused = core.response_history(history, "chat")[-12:]
    messages = [{"role": "system", "content": system}, *focused]
    if action == "chat":
        answer = core.utility_llm("casual_chat", messages, max_tokens=500).strip()
    else:
        answer = core.deepseek(
            messages,
            max_tokens=1800 if reading else 500,
            task="tarot_reading" if reading else "answer",
        ).strip()
    if not _is_russian_client_text(answer):
        retry_messages = [
            {
                "role": "system",
                "content": system
                + "\n\nThe previous draft violated the output-language rule. Rewrite the complete "
                  "answer in Russian only. Do not mention this correction.",
            },
            *focused,
        ]
        if action == "chat":
            answer = core.utility_llm("casual_chat", retry_messages, max_tokens=500).strip()
        else:
            answer = core.deepseek(
                retry_messages,
                max_tokens=1800 if reading else 500,
                task="tarot_reading_retry" if reading else "answer_retry",
            ).strip()
    answer = clean_client_answer(answer)
    if reading:
        answer = format_layout_overview(reading) + "\n\n" + answer
    if first_contact:
        answer = INTRODUCTION_RU + "\n\n" + answer
    return {
        "answer": answer,
        "plan": plan,
        "reading": reading,
        "metadata_before": metadata,
        "chat_id": chat_id,
        "user_id": user_id,
        "preferred_name": name,
        "history_for_memory": focused[-4:],
        "prelude": reading_prelude(
            chat_id, user_id, plan["question"], metadata["consultation_count"]
        ) if reading else None,
    }


def _explicit_address_request(text):
    return bool(re.search(
        r"\b(?:зови(?:те)?|называй(?:те)?|обращай(?:те)?сь\s+ко\s+мне)\b",
        text.lower(),
    ))


def _address_claim(text):
    return bool(re.search(
        r"\b(?:address(?:ed|ing)?|call(?:ed)?(?:\s+(?:me|him|her|them))?|"
        r"refer(?:red)?\s+to|form of address|name(?:d)?\s+as)\b",
        text.lower(),
    ))


def _compact_metadata(previous, user_text, answer, plan, reading, recent_dialogue=None):
    prompt = (
        "Update compact long-term client metadata for a Tarot consultant. Return JSON only with "
        "summary_en, key_points_en, open_threads_en, preferences_en, and topic_blocks_en. All values "
        "must be English. topic_blocks_en must contain only these thematic arrays when relevant: "
        "personal, relationships, work_money, wellbeing, interests, communication, open_threads. "
        "summary_en: at most 90 words. Each list: at most 8 short items, each at most 18 words. "
        "Keep only client-provided facts, key questions, reading continuity, feedback, preferences, "
        "and unresolved threads. Do not store unnecessary sensitive data, inferred diagnoses, exact "
        "addresses, passwords, financial identifiers, or unsupported hypotheses. A Tarot inference is "
        "not a verified client fact. Preserve important earlier context unless corrected."
        " Interpret short replies using the exact preceding question. Never infer a preferred form of address "
        "from a profile or display name; store it only when the client explicitly requests it."
    )
    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "previous": previous,
                    "recent_dialogue_ru": recent_dialogue or [],
                    "new_client_message_ru": user_text,
                    "consultant_answer_ru": answer,
                    "route": plan,
                    "reading": reading,
                },
                ensure_ascii=False,
            ),
        },
    ]
    raw = core.utility_llm("metadata", messages, max_tokens=650, json_output=True)
    data = json.loads(raw)
    if re.search(r"[А-Яа-яЁё]{3,}", json.dumps(data, ensure_ascii=False)):
        raise ValueError("Metadata must be stored in English")
    raw_blocks = data.get("topic_blocks_en", {})
    topic_blocks = {
        key: [str(item)[:180] for item in raw_blocks.get(key, [])[:6]]
        for key in TOPIC_KEYS
        if isinstance(raw_blocks, dict) and isinstance(raw_blocks.get(key), list)
    }
    preferences = [str(item)[:180] for item in data.get("preferences_en", [])[:8]]
    if not _explicit_address_request(user_text):
        preferences = [item for item in preferences if not _address_claim(item)]
        if "communication" in topic_blocks:
            topic_blocks["communication"] = [
                item for item in topic_blocks["communication"] if not _address_claim(item)
            ]
    return {
        "summary_en": str(data.get("summary_en", ""))[:1200],
        "key_points_en": [str(item)[:180] for item in data.get("key_points_en", [])[:8]],
        "open_threads_en": [str(item)[:180] for item in data.get("open_threads_en", [])[:8]],
        "preferences_en": preferences,
        "topic_blocks_en": topic_blocks,
    }


def record_exchange(prepared, user_text):
    previous = prepared["metadata_before"]
    try:
        compact = _compact_metadata(
            previous, user_text, prepared["answer"], prepared["plan"], prepared["reading"],
            prepared.get("history_for_memory", []),
        )
    except (RuntimeError, json.JSONDecodeError, TypeError, ValueError):
        logging.exception("Client metadata update failed; preserving previous compact state")
        compact = {
            "summary_en": previous["summary_en"],
            "key_points_en": previous["key_points_en"],
            "open_threads_en": previous["open_threads_en"],
            "preferences_en": previous["preferences_en"],
            "topic_blocks_en": previous.get("topic_blocks_en", {}),
        }
    reading_id = None
    now = int(time.time())
    if prepared["reading"]:
        reading_id = str(uuid.uuid4())
    offered_personal_deck = bool(re.search(
        r"\b(?:отдельн\w*|персональн\w*|личн\w*)\s+колод\w*\b",
        prepared["answer"].lower(),
    ))
    with core.connect_db() as connection:
        connection.execute(
            """
            UPDATE client_metadata SET
                preferred_name=?, summary_en=?, key_points_en=?, open_threads_en=?,
                preferences_en=?, topic_blocks_en=?, visit_count=visit_count+1,
                consultation_count=consultation_count+?, updated_at=?,
                personal_deck_offer_made=CASE
                    WHEN personal_deck_offer_made=1 OR ?=1 THEN 1 ELSE 0 END
            WHERE chat_id=? AND user_id=?
            """,
            (
                prepared["preferred_name"], compact["summary_en"],
                json.dumps(compact["key_points_en"], ensure_ascii=True),
                json.dumps(compact["open_threads_en"], ensure_ascii=True),
                json.dumps(compact["preferences_en"], ensure_ascii=True),
                json.dumps(compact.get("topic_blocks_en", {}), ensure_ascii=True),
                1 if prepared["reading"] else 0, now, int(offered_personal_deck),
                prepared["chat_id"], prepared["user_id"],
            ),
        )
        if reading_id:
            connection.execute(
                """
                INSERT INTO tarot_readings
                    (reading_id, chat_id, user_id, question_ru, spread_id, deck_id,
                     draw_json, answer_ru, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    reading_id, prepared["chat_id"], prepared["user_id"],
                    prepared["plan"]["question"], prepared["reading"]["spread"],
                    prepared["reading"]["deck"],
                    json.dumps(prepared["reading"], ensure_ascii=False),
                    prepared["answer"], now,
                ),
            )
    return reading_id
