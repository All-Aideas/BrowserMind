export interface SampleCase {
  id: string;
  label: string;
  kind: string;
  traceback: string;
  code: string;
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: "missing-column",
    label: "KeyError · columna",
    kind: "Reparación automática",
    traceback: "KeyError: 'revenue'",
    code: `import pandas as pd

df = pd.DataFrame({
    "revenue_total": [120, 90, 150],
    "region": ["sur", "norte", "sur"],
})

total_revenue = df["revenue"].sum()
print(total_revenue)`,
  },
  {
    id: "type-mismatch",
    label: "TypeError · tipos",
    kind: "Normalización guardada",
    traceback: "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    code: `import pandas as pd

df = pd.DataFrame({"amount": ["12", "9", "15"]})
average = df["amount"].mean()
print(average)`,
  },
  {
    id: "shape-mismatch",
    label: "ValueError · shape",
    kind: "Escalamiento manual",
    traceback: "ValueError: X has 3 features, but model expects 4",
    code: `import numpy as np

X_test = np.ones((4, 3))
predictions = model.predict(X_test)
print(predictions)`,
  },
  {
    id: "invalid-values",
    label: "ValueError · NaN",
    kind: "Limpieza guardada",
    traceback: "ValueError: Input contains NaN, infinity or a value too large",
    code: `import numpy as np
import pandas as pd

df = pd.DataFrame({"signal": [1.0, np.nan, np.inf]})
model.fit(df[["signal"]], target)`,
  },
  {
    id: "merge-alignment",
    label: "Merge · alineación",
    kind: "Diagnóstico estructural",
    traceback: "KeyError: 'customer_id' while merging datasets",
    code: `import pandas as pd

orders = pd.DataFrame({"customer_id": [1, 2], "total": [20, 30]})
profiles = pd.DataFrame({"client_id": [1, 2], "name": ["A", "B"]})
joined = orders.merge(profiles, on="customer_id")`,
  },
];
