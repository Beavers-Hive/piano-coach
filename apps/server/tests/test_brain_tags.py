from piano_coach.brain import ActionReady, SayDelta, TagStreamParser


def test_tag_parser_streams_say_deltas_and_waits_for_complete_action():
    parser = TagStreamParser()
    first = parser.feed("<say>いい")
    second = parser.feed("ね</say><action>{\"type\":\"next\"}")
    third = parser.feed("</action>", final=True)
    spoken = "".join(event.text for event in first + second + third if isinstance(event, SayDelta))
    actions = [event.action for event in first + second + third if isinstance(event, ActionReady)]
    assert spoken == "いいね"
    assert actions == [{"type": "next"}]
