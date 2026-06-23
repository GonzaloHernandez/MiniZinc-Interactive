array [1..4] of var 1..9: e;
include "alldifferent.mzn";
constraint alldifferent(e);
constraint e[1] = 9;
constraint e[2] = 8;
constraint e[3] = 7;
solve satisfy;
output [show(e), "\n"];
