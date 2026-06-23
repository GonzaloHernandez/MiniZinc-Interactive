% Classic Cryptarithmetic Puzzle: SEND + MORE = MONEY
% Open this file in the editor to test your new MiniZinc extension!

include "alldifferent.mzn";

% Decision variables (digits 0 to 9)
var 1..9: S;
var 0..9: E;
var 0..9: N;
var 0..9: D;
var 1..9: M;
var 0..9: O;
var 0..9: R;
var 0..9: Y;

% Digits must be distinct
constraint alldifferent([S, E, N, D, M, O, R, Y]);

% Sum equation constraint
constraint                  1000 * S + 100 * E + 10 * N + D
                          + 1000 * M + 100 * O + 10 * R + E
  == 10000 * M + 1000 * O + 100 * N + 10 * E + Y;

% Goal
solve satisfy;


% Formatted Output
output [
  "  ", show(S), " ", show(E), " ", show(N), " ", show(D), "\n",
  "+ ", show(M), " ", show(O), " ", show(R), " ", show(E), "\n",
  "= ", show(M), " ", show(O), " ", show(N), " ", show(E), " ", show(Y), "\n"
];
