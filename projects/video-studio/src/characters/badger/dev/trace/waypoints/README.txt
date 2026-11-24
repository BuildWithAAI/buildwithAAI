How traces/*.json were made (re-run only to re-trace from the crops; build.sh does not need this):
  python3 -I trace_view.py wp_<view> badger_<crop>.png out.json 9
tools.py skeletonises the crop's near-black lines (Zhang-Suen), snaps each waypoint to the line centre and
follows the skeleton between waypoints, resampling every ~9 crop px. Waypoints flagged 'n' are used as typed
(read off zoomed grid overlays where lines merge); 'c' marks a corner. Some traces (back.json shoulders) were then
hand-corrected from row scans of the skeleton. traces/right.json comes from wp_right; threeQuarter from wp_34.
