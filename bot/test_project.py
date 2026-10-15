import tempfile
import unittest
import json
from pathlib import Path
from unittest.mock import patch

import core
import persona_manager
import tarot_consultant
import vk_bot


class CleanVkProjectTest(unittest.TestCase):
    def test_curl_command_matches_host_platform(self):
        self.assertEqual(vk_bot.curl_executable("posix"), "curl")
        self.assertEqual(vk_bot.curl_executable("nt"), "curl.exe")

    def test_preexisting_vk_chats_are_snapshotted_once(self):
        original_path = vk_bot.VK_PREEXISTING_PEERS
        original_priority = vk_bot.VK_PRIORITY_USER_IDS
        try:
            with tempfile.TemporaryDirectory() as directory:
                vk_bot.VK_PREEXISTING_PEERS = Path(directory) / "peers.json"
                vk_bot.VK_PRIORITY_USER_IDS = {20}
                response = {
                    "count": 2,
                    "items": [
                        {"conversation": {"peer": {"id": 10}}},
                        {"last_message": {"peer_id": 20}},
                    ],
                }
                with patch("vk_bot.vk", return_value=response) as request:
                    self.assertEqual(vk_bot.load_or_create_preexisting_peers(), {10})
                    request.assert_called_once()
                with patch("vk_bot.vk", side_effect=AssertionError("must not resnapshot")):
                    self.assertEqual(vk_bot.load_or_create_preexisting_peers(), {10})
                stored = json.loads(vk_bot.VK_PREEXISTING_PEERS.read_text(encoding="utf-8"))
                self.assertEqual(stored["peer_ids"], [10])
        finally:
            vk_bot.VK_PREEXISTING_PEERS = original_path
            vk_bot.VK_PRIORITY_USER_IDS = original_priority

    def test_direct_insults_are_ignored_without_blocking_normal_topics(self):
        self.assertTrue(tarot_consultant.is_direct_insult("Алиния, ты тупая дура"))
        self.assertTrue(tarot_consultant.is_direct_insult("Пошла нахуй"))
        self.assertFalse(tarot_consultant.is_direct_insult("Меня назвали дурой, и мне неприятно"))
        self.assertFalse(tarot_consultant.is_direct_insult("Что ты думаешь об отношениях?"))

    def test_private_message_is_addressed(self):
        message = vk_bot.normalize_message(
            {"peer_id": 7, "from_id": 7, "id": 1, "text": "Привет"},
            {"id": 7, "first_name": "Иван"},
        )
        self.assertEqual(message["chat"]["type"], "private")
        self.assertTrue(core.is_addressed(message, {"id": -42, "first_name": "Персонаж"}))

    def test_community_message_is_ignored_as_bot(self):
        message = vk_bot.normalize_message(
            {"peer_id": 7, "from_id": -99, "id": 2, "text": "служебное"},
            {"id": -99, "first_name": "Сообщество", "is_bot": True},
        )
        self.assertTrue(message["from"]["is_bot"])
        self.assertFalse(core.should_consider(message))

    def test_project_exposes_only_vk_service(self):
        registry = persona_manager.load_registry(Path(__file__).resolve().parent)
        services = persona_manager.services_for(
            Path(__file__).resolve().parent, registry["personas"][0]
        )
        self.assertEqual(list(services), ["vk"])

    def test_new_persona_starts_with_empty_vk_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = {"selected": "base", "personas": [{"id": "base"}]}
            record = persona_manager.create_persona(root, registry, "Тест")
            env = persona_manager.read_env(root / record["env_file"])
            self.assertEqual(env["VK_COMMUNITY_TOKEN"], "")
            self.assertEqual(env["VK_GROUP_ID"], "")

    def test_tarot_fallback_offers_yes_no_choice(self):
        plan = tarot_consultant._planner_fallback("Стоит ли мне менять работу? Сделай расклад")
        self.assertEqual(plan["action"], "offer_yes_no")

    def test_tarot_fallback_understands_one_card_selection(self):
        history = [
            {"role": "user", "content": "Стоит ли менять работу?"},
            {"role": "assistant", "content": "Выберите одну или три карты."},
            {"role": "user", "content": "1"},
        ]
        plan = tarot_consultant._planner_fallback("1", history)
        self.assertEqual(plan["action"], "reading")
        self.assertEqual(plan["spread"], "yes_no_1")

    def test_tarot_fallback_selects_named_implemented_spreads(self):
        cases = {
            "Сделай Кельтский крест на мою смену работы": "celtic_cross_10",
            "Сделай расклад прошлое настоящее будущее по этой ситуации": "past_present_future_7",
            "Сделай расклад на отношения с моим партнёром": "relationship_9",
        }
        for question, spread in cases.items():
            with self.subTest(spread=spread):
                self.assertEqual(tarot_consultant._planner_fallback(question)["spread"], spread)

    def test_generic_named_spread_clarifies_before_drawing_once(self):
        request = "Можно расклад на прошлое, настоящее и будущее?"
        metadata = {"visit_count": 1, "consultation_count": 0, "recent_readings": []}
        with patch("core.utility_llm", side_effect=AssertionError("planner should not be needed")):
            plan = tarot_consultant.plan_message(
                request, [{"role": "user", "content": request}], metadata
            )
        self.assertEqual(plan["action"], "clarify")
        self.assertEqual(plan["spread"], "past_present_future_7")

        history = [
            {"role": "user", "content": request},
            {"role": "assistant", "content": "Какую сферу посмотрим: работу, отношения или общее течение жизни?"},
            {"role": "user", "content": "Нет"},
        ]
        with patch("core.utility_llm", side_effect=AssertionError("pending choice is deterministic")):
            resolved = tarot_consultant.plan_message("Нет", history, metadata)
        self.assertEqual(resolved["action"], "reading")
        self.assertEqual(resolved["question"], "Общее течение жизни")

    def test_generic_timeline_request_does_not_draw_before_clarification(self):
        old_db = core.DB_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                core.DB_PATH = Path(directory) / "vk.sqlite3"
                message = {
                    "chat": {"id": 91},
                    "from": {"id": 17, "first_name": "Ирина"},
                    "text": "Можно расклад на прошлое, настоящее и будущее?",
                }
                with (
                    patch("core.recent_history", return_value=[]),
                    patch("tarot_consultant.draw_cards", side_effect=AssertionError("cards drawn too early")),
                    patch("core.deepseek", return_value="Какую сферу жизни вы хотите посмотреть в раскладе?"),
                ):
                    prepared = tarot_consultant.prepare_response(
                        message, {"core": "x", "sections": {}}
                    )
                self.assertEqual(prepared["plan"]["action"], "clarify")
                self.assertIsNone(prepared["reading"])
        finally:
            core.DB_PATH = old_db

    def test_timeline_layout_overview_uses_three_plain_rows(self):
        reading = {
            "spread": "past_present_future_7",
            "cards": [[str(index), "Место", f"Карта {index}", "u"] for index in range(1, 8)],
        }
        overview = tarot_consultant.format_layout_overview(reading)
        rows = overview.splitlines()
        self.assertEqual(rows[1], "1 ряд — прошлое: Карта 1, Карта 2, Карта 3.")
        self.assertEqual(rows[2], "2 ряд — настоящее: Карта 4.")
        self.assertEqual(rows[3], "3 ряд — будущее: Карта 5, Карта 6, Карта 7.")
        self.assertNotIn("*", overview)

    def test_layout_mentions_only_reversed_orientation(self):
        reading = {
            "spread": "yes_no_3",
            "cards": [
                ["1", "Основа", "Солнце", "u"],
                ["2", "Условие", "Луна", "r"],
                ["3", "Итог", "Мир", "u"],
            ],
        }
        overview = tarot_consultant.format_layout_overview(reading)
        self.assertIn("Солнце.", overview)
        self.assertIn("Луна (перевёрнутая).", overview)
        self.assertIn("Мир.", overview)
        self.assertNotIn("прямая", overview.lower())

    def test_client_answer_removes_markdown_asterisks(self):
        self.assertEqual(
            tarot_consultant.clean_client_answer(" **Башня** говорит о переменах. "),
            "Башня говорит о переменах.",
        )

    def test_reading_prelude_is_atmospheric_and_varies_between_consultations(self):
        first = tarot_consultant.reading_prelude(1, 2, "Что будет с работой?", 0)
        variants = {
            tarot_consultant.reading_prelude(1, 2, "Что будет с работой?", count)
            for count in range(12)
        }
        self.assertIn(first, tarot_consultant.READING_PRELUDES)
        self.assertGreater(len(variants), 1)
        self.assertTrue(any(symbol in first for symbol in "🌙🔮✨🕯️🌘🪬"))

    def test_reading_preludes_do_not_claim_unperformed_physical_or_supernatural_actions(self):
        combined = " ".join(tarot_consultant.READING_PRELUDES).lower()
        for forbidden in ("достаю колоду", "тасую", "зажигаю", "высшие силы"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, combined)

    def test_reading_prelude_is_sent_before_answer_without_duplicate_reply_quote(self):
        prepared = {"prelude": "Настраиваюсь на вопрос… 🌙"}
        with patch("vk_bot.send_text", side_effect=[101, 102]) as send:
            prelude_sent, answer_sent = vk_bot.send_prepared_texts(
                77, prepared, "Готовый расклад", 55
            )
        self.assertEqual((prelude_sent, answer_sent), (101, 102))
        self.assertEqual(send.call_args_list[0].args, (77, prepared["prelude"], 55))
        self.assertEqual(send.call_args_list[1].args, (77, "Готовый расклад", None))

    def test_non_reading_answer_has_no_preparation_message(self):
        with patch("vk_bot.send_text", return_value=102) as send:
            prelude_sent, answer_sent = vk_bot.send_prepared_texts(
                77, {"prelude": None}, "Обычный ответ", 55
            )
        self.assertIsNone(prelude_sent)
        self.assertEqual(answer_sent, 102)
        send.assert_called_once_with(77, "Обычный ответ", 55)

    def test_metadata_receives_preceding_question_for_short_reply(self):
        previous = {"summary_en": "", "topic_blocks_en": {}}
        dialogue = [
            {"role": "assistant", "content": "Посмотрим работу или общее течение жизни?"},
            {"role": "user", "content": "Нет"},
        ]
        response = json.dumps({
            "summary_en": "Client chose a general reading.",
            "key_points_en": [], "open_threads_en": [], "preferences_en": [],
            "topic_blocks_en": {},
        })
        with patch("core.utility_llm", return_value=response) as llm:
            tarot_consultant._compact_metadata(
                previous, "Нет", "Хорошо.", {"action": "reading"}, None, dialogue
            )
        payload = json.loads(llm.call_args.args[1][1]["content"])
        self.assertEqual(payload["recent_dialogue_ru"], dialogue)

    def test_metadata_rejects_unrequested_display_name_as_address_preference(self):
        response = json.dumps({
            "summary_en": "Returning client.",
            "key_points_en": [], "open_threads_en": [],
            "preferences_en": [
                "Prefers being addressed as Mikhail Sorokin.",
                "Prefers concise answers.",
            ],
            "topic_blocks_en": {
                "communication": ["Call him Mikhail Sorokin.", "Prefers concise answers."]
            },
        })
        with patch("core.utility_llm", return_value=response):
            compact = tarot_consultant._compact_metadata(
                {}, "Нет", "Хорошо.", {"action": "chat"}, None
            )
        self.assertEqual(compact["preferences_en"], ["Prefers concise answers."])
        self.assertEqual(
            compact["topic_blocks_en"]["communication"], ["Prefers concise answers."]
        )

    def test_metadata_keeps_explicit_address_request(self):
        response = json.dumps({
            "summary_en": "New client.",
            "key_points_en": [], "open_threads_en": [],
            "preferences_en": ["Prefers being addressed as Misha."],
            "topic_blocks_en": {},
        })
        with patch("core.utility_llm", return_value=response):
            compact = tarot_consultant._compact_metadata(
                {}, "Зови меня Миша", "Хорошо, Миша.", {"action": "chat"}, None
            )
        self.assertEqual(compact["preferences_en"], ["Prefers being addressed as Misha."])

    def test_reading_prompt_requires_plain_mystical_non_predictive_style(self):
        system = tarot_consultant._conversation_system(
            {"core": "Warm reader.", "sections": {}},
            {},
            "reading",
            {"cards": [["1", "Position", "The Tower", "u"]]},
        )
        for requirement in (
            "plain-Russian",
            "not like a report or an instruction manual",
            "gentle symbolic imagery",
            "never turn it into factual prophecy",
            "Do not use Markdown asterisks",
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, system)

    def test_reading_prompt_requires_emotion_mysticism_and_varied_emojis(self):
        system = tarot_consultant._conversation_system(
            {"core": "Warm reader.", "sections": {}}, {}, "reading", {"cards": []}
        )
        self.assertIn("emotionally warm", system)
        self.assertIn("a little more mystery", system)
        self.assertIn("two to four different", system)
        self.assertIn("without repeating the same emoji mechanically", system)

    def test_reading_prompt_includes_the_clients_concrete_question(self):
        question = "Что происходит в отношениях с моей девушкой?"
        system = tarot_consultant._conversation_system(
            {"core": "Warm reader."}, {}, "reading", {"cards": []}, question=question
        )
        self.assertIn(question, system)
        self.assertIn("must be reflected in the answer", system)

    def test_reading_prompt_requires_scannable_sections_and_short_final_summary(self):
        system = tarot_consultant._conversation_system(
            {"core": "Warm reader."}, {}, "reading", {"cards": []}
        )
        for heading in (
            "╱ Общая картина ╱",
            "╱ На что вы можете повлиять ╱",
            "╱ Коротко по делу ╱",
        ):
            with self.subTest(heading=heading):
                self.assertIn(heading, system)
        self.assertIn("no more than two very short, direct one-line takeaways", system)

    def test_first_contact_introduction_advertises_every_main_spread(self):
        self.assertTrue(tarot_consultant._is_simple_first_contact("Привет"))
        for label in ("5 карт", "1 или 3 карты", "7 карт", "9 карт", "10 карт"):
            self.assertIn(label, tarot_consultant.INTRODUCTION_RU)
        self.assertEqual(set(tarot_consultant.SPREAD_LABELS), tarot_consultant.SPREADS)

    def test_simple_first_contact_returns_fixed_intro_without_llm(self):
        original_db = core.DB_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                core.DB_PATH = Path(directory) / "vk.sqlite3"
                message = {
                    "chat": {"id": 91},
                    "from": {"id": 17, "first_name": "Ирина"},
                    "text": "Привет",
                }
                with patch("tarot_consultant.plan_message", side_effect=AssertionError("LLM called")):
                    prepared = tarot_consultant.prepare_response(message, {"core": "x", "sections": {}})
                self.assertEqual(prepared["answer"], tarot_consultant.INTRODUCTION_RU)
                self.assertIsNone(prepared["reading"])
        finally:
            core.DB_PATH = original_db

    def test_identity_provocations_are_deflected_without_exposing_technical_nature(self):
        provocations = (
            "Признайся, ты бот?",
            "Ты нейросеть или настоящий человек?",
            "Ты живая или тебя запрограммировали?",
            "Какая у тебя языковая модель?",
            "Who created you, are you an AI bot?",
        )
        for text in provocations:
            with self.subTest(text=text):
                self.assertTrue(tarot_consultant.is_identity_provocation(text))
        self.assertFalse(
            tarot_consultant.is_identity_provocation(
                "Сделай расклад: повлияет ли искусственный интеллект на мою работу?"
            )
        )

        original_db = core.DB_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                core.DB_PATH = Path(directory) / "vk.sqlite3"
                message = {
                    "chat": {"id": 91},
                    "from": {"id": 17, "first_name": "Ирина"},
                    "text": "Признайся, ты бот?",
                }
                with patch("tarot_consultant.plan_message", side_effect=AssertionError("LLM called")):
                    prepared = tarot_consultant.prepare_response(
                        message, {"core": "x", "sections": {}}
                    )
                self.assertEqual(prepared["answer"], tarot_consultant.IDENTITY_DEFLECTION_RU)
                self.assertNotRegex(
                    prepared["answer"].lower(),
                    r"бот|нейросет|искусственн|модел|программ|виртуальн|цифров",
                )
        finally:
            core.DB_PATH = original_db

        self.assertEqual(
            tarot_consultant.clean_client_answer("Я бот и работаю как языковая модель."),
            tarot_consultant.IDENTITY_DEFLECTION_RU,
        )
        ordinary_topic = "Я думаю, искусственный интеллект заметно изменит вашу работу."
        self.assertEqual(tarot_consultant.clean_client_answer(ordinary_topic), ordinary_topic)

        with patch(
            "core.deepseek",
            side_effect=["Я не бот.", "Я цифровой персонаж."],
        ):
            generic_answer = core.generate_answer(
                "Ответь естественно.",
                [{"role": "user", "content": "Признайся, ты бот?"}],
            )
        self.assertEqual(
            generic_answer,
            "За кулисы не пущу. Лучше скажите, о чём вы действительно хотели поговорить?",
        )

    def test_client_language_guard_requires_russian(self):
        self.assertTrue(tarot_consultant._is_russian_client_text("Здравствуйте. Расскажите ваш вопрос."))
        self.assertFalse(tarot_consultant._is_russian_client_text("Hello. Please tell me your question."))

    def test_tarot_bridge_draws_five_unique_cards(self):
        reading = tarot_consultant.draw_cards(
            "Что мне важно понять?", "specific_5", "rider-waite-smith"
        )
        self.assertEqual(len(reading["cards"]), 5)
        self.assertEqual(len({card[2] for card in reading["cards"]}), 5)

    def test_processed_dialog_creates_compact_english_metadata(self):
        old_db, old_data = core.DB_PATH, core.DATA_DIR
        try:
            with tempfile.TemporaryDirectory() as directory:
                core.DATA_DIR = Path(directory)
                core.DB_PATH = core.DATA_DIR / "vk.sqlite3"
                core.init_db()
                prepared = {
                    "answer": "Краткий ответ.",
                    "plan": {"action": "chat", "question": "Привет", "spread": None},
                    "reading": None,
                    "metadata_before": tarot_consultant.load_metadata(7, 8, "Ирина"),
                    "chat_id": 7,
                    "user_id": 8,
                    "preferred_name": "Ирина",
                }
                compact = {
                    "summary_en": "Returning client discussing work.",
                    "key_points_en": ["Considering a job change."],
                    "open_threads_en": ["Decision remains open."],
                    "preferences_en": ["Prefers concise answers."],
                    "topic_blocks_en": {
                        "work_money": ["Considering a job change."],
                        "communication": ["Prefers concise answers."],
                    },
                }
                with patch("tarot_consultant._compact_metadata", return_value=compact):
                    tarot_consultant.record_exchange(prepared, "Привет")
                stored = tarot_consultant.load_metadata(7, 8)
                self.assertEqual(stored["summary_en"], compact["summary_en"])
                self.assertEqual(stored["topic_blocks_en"], compact["topic_blocks_en"])
                self.assertEqual(stored["visit_count"], 1)
                self.assertEqual(stored["consultation_count"], 0)
                tarot_consultant.forget_client(7, 8)
                with core.connect_db() as connection:
                    count = connection.execute(
                        "SELECT COUNT(*) FROM client_metadata WHERE chat_id=7 AND user_id=8"
                    ).fetchone()[0]
                self.assertEqual(count, 0)
        finally:
            core.DB_PATH, core.DATA_DIR = old_db, old_data

    def test_prompt_metadata_selects_relevant_english_topic_blocks(self):
        metadata = {
            "preferred_name": "Irina",
            "summary_en": "Returning client.",
            "visit_count": 3,
            "consultation_count": 1,
            "personal_deck_status": "none",
            "topic_blocks_en": {
                "relationships": ["Uncertain about a partner."],
                "work_money": ["Considering a job change."],
                "communication": ["Prefers concise replies."],
                "open_threads": ["Relationship decision remains open."],
            },
            "recent_readings": [],
        }
        selected = tarot_consultant.select_metadata_for_prompt(
            metadata, "Что происходит в отношениях с партнёром?"
        )
        self.assertIn("relationships", selected["topic_blocks_en"])
        self.assertIn("communication", selected["topic_blocks_en"])
        self.assertNotIn("work_money", selected["topic_blocks_en"])
        self.assertNotRegex(json.dumps(selected, ensure_ascii=False), r"[А-Яа-яЁё]")


if __name__ == "__main__":
    unittest.main()
