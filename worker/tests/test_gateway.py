from sentinel_voice_worker.gateway import VoiceRouteContext, decode_participant_metadata


def test_round_trips_full_context():
    raw = '{"agentId":"hermes-lisa","roomId":"room-1","userId":"user-1","workspaceId":"ws-1"}'
    assert decode_participant_metadata(raw) == VoiceRouteContext(
        agent_id="hermes-lisa", room_id="room-1", user_id="user-1", workspace_id="ws-1"
    )


def test_round_trips_without_optional_workspace_id():
    raw = '{"agentId":"hermes-lisa","roomId":"room-1","userId":"user-1"}'
    assert decode_participant_metadata(raw) == VoiceRouteContext(
        agent_id="hermes-lisa", room_id="room-1", user_id="user-1", workspace_id=None
    )


def test_returns_none_for_missing_or_empty_input():
    assert decode_participant_metadata(None) is None
    assert decode_participant_metadata("") is None


def test_returns_none_for_malformed_json():
    assert decode_participant_metadata("{not json") is None


def test_returns_none_when_required_fields_missing():
    assert decode_participant_metadata('{"agentId":"a"}') is None
