from sentinel_voice_worker.gateway import room_id_from_livekit_room_name


def test_parses_room_id_out_of_a_sentinel_voice_room_name():
    assert room_id_from_livekit_room_name("sentinel-voice-room-123") == "room-123"


def test_returns_none_for_a_room_name_outside_sentinels_namespace():
    assert room_id_from_livekit_room_name("some-other-room") is None
    assert room_id_from_livekit_room_name("") is None
