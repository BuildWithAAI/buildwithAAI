"""Forearm-spot measurements taken on the two labelled coat maps (round 4, R3 review).

Every far-forearm edge record and every left-facing-pose forearm record is placed from THESE numbers: the marking's own
coat map gives how far down the forearm it sits, how far across from the front edge, its size and its tilt. No forearm
record is placed from the other side's record (the R3 review found SIT_LEFT / LIE_LEFT L-09 sharing the right poses' R-08
centres, 0.6 / 0.8 units from an x-mirror).

Measured on reference/crops/badger_coat_left.png (CL px) and badger_coat_right.png (CR px), 2x the approved sheet:
  * centre: the moments of the spot's dark component (tools: flood fill at grey < 110);
  * elbow: the first row where the forearm's REAR contour core is darker than grey 120 (the elbow tip under the chest;
    coat_left x 237-238 from y 265, coat_right x 380-381 from y 267);
  * wrist: the rigs' wrist cut (gen_left.py / gen_right.py FRONT_WRIST, y 398 on both maps);
  * front / back: the centre lines of the forearm's front and rear contours on the rows through the spot (y +-3);
  * size: the rigs' own records of the marking (gen_left.py L-09, gen_right.py R-08: semi-axes across, along);
  * tilt: the long axis's lean from the forearm axis, moments of the dark component, + = top leans to the BACK.
"""

KX_L, KY_L = 0.9398, 1.0455     # coat_left px -> world units (gen_left.py, decision D01)
KX_R, KY_R = 0.9734, 1.0283     # coat_right px -> world units (gen_right.py)

FOREARM = {
    'L-09': {'crop': 'badger_coat_left.png', 'centre': (208.52, 314.47), 'elbow_y': 265.0, 'wrist_y': 398.0,
             'front_x': 192.57, 'back_x': 234.0, 'size_px': (7.6, 12.2), 'k': (KX_L, KY_L), 'tilt_back': 1.8},
    'R-08': {'crop': 'badger_coat_right.png', 'centre': (407.95, 313.76), 'elbow_y': 267.0, 'wrist_y': 398.0,
             'front_x': 424.57, 'back_x': 384.0, 'size_px': (8.0, 12.2), 'k': (KX_R, KY_R), 'tilt_back': 1.6},
}

# Only the outer edge of a FAR forearm shows, so the across-leg semi-axis of an edge record is foreshortened (the sitting
# panel draws its far forearm mark about 4.5 px wide against a 6.2-6.5 px half-width; round 3, BADGER-D23 R-08).
EDGE_K = 0.70


def along(sid):
    """How far down the forearm the spot's centre sits: 0 at the elbow tip, 1 at the wrist cut."""
    f = FOREARM[sid]
    return (f['centre'][1] - f['elbow_y']) / (f['wrist_y'] - f['elbow_y'])


def across_from_front(sid):
    """How far across the forearm the centre sits, measured from the FRONT contour (0) to the rear contour (1)."""
    f = FOREARM[sid]
    return abs(f['centre'][0] - f['front_x']) / abs(f['back_x'] - f['front_x'])


def size_units(sid, edge=False):
    """(across, along) semi-axes in world units; `edge` foreshortens the across axis (a far leg shows its edge only)."""
    f = FOREARM[sid]
    across = f['size_px'][0] * f['k'][0] * (EDGE_K if edge else 1.0)
    along_ = f['size_px'][1] * f['k'][1]
    return across, along_


def tilt_back(sid):
    return FOREARM[sid]['tilt_back']
