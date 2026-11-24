from smr import chain, config as C


def test_launch_price_ratio_is_one_at_full_curve():
    full_ata = C.PUMP_INITIAL_REAL_TOKEN_RAW + C.PUMP_CURVE_RESERVED_RAW
    assert abs(chain.price_ratio_vs_launch(full_ata) - 1.0) < 1e-12
    assert chain.curve_progress(full_ata) == 0.0


def test_completion_ratio_and_progress():
    # curve ATA keeps the 206.9M migration reserve until migration; real reserves 0 -> complete
    assert chain.curve_real_tokens(C.PUMP_CURVE_RESERVED_RAW) == 0
    assert chain.curve_progress(C.PUMP_CURVE_RESERVED_RAW) == 1.0
    r = chain.price_ratio_vs_launch(0)
    assert 14.6 < r < 14.8


def test_curve_from_create_ignores_mayhem_agent():
    tx = {"meta": {"postTokenBalances": [
        {"mint": "M", "owner": "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s", "uiTokenAmount": {"amount": str(10**15)}},
        {"mint": "M", "owner": "CURVE", "uiTokenAmount": {"amount": str(996 * 10**12)}}]}}
    assert chain.curve_from_create(tx, "M") == "CURVE"
