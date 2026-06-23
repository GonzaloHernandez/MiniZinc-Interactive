% Classic Knapsack Optimization Problem

int: n;                  % Number of items
int: capacity;           % Maximum capacity of knapsack
array[1..n] of int: profits;
array[1..n] of int: weights;

% Decision variables: 1 if item i is selected, 0 otherwise
array[1..n] of var 0..1: x;

% Total weight must not exceed capacity
constraint sum(i in 1..n)(x[i] * weights[i]) <= capacity;

% Maximize total profit
solve maximize sum(i in 1..n)(x[i] * profits[i]);

% Formatted Output
output [
  "Selected items selector: ", show(x), "\n",
  "Total Profit: ", show(sum(i in 1..n)(x[i] * profits[i])), "\n",
  "Total Weight: ", show(sum(i in 1..n)(x[i] * weights[i])), " / ", show(capacity), "\n"
];
