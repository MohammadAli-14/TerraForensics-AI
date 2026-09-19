#!/usr/bin/env python3
"""
benchmark_classifiers.py — Experiment 2: Routing Classifier Comparison

Compares three classification approaches on the 180-query labeled dataset
(results/labeled_benchmark_dataset.json) under 5-fold cross-validation:
  1. Method 1: Production Regex / Word-Boundary Rule-Based Router
  2. Method 2: TF-IDF (1-2 gram) + Logistic Regression
  3. Method 3: TF-IDF (1-2 gram) + Linear SVM (LinearSVC)
  [Bonus baseline]: TF-IDF + Multinomial Naive Bayes

Metrics:
  - Accuracy (%)
  - Precision (%) [GTD as positive]
  - Recall (%) [GTD as positive]
  - F1-Score (%)
  - Average Inference Latency (ms/query)
"""

import json
import re
import time
import os
from pathlib import Path
import numpy as np
from sklearn.model_selection import StratifiedKFold
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

# Determine paths
REPO_ROOT = Path(__file__).resolve().parent.parent
DATASET_PATH = REPO_ROOT / "results" / "labeled_benchmark_dataset.json"

# Production attack synonyms and GTD keywords aligned with contextExtractor.js
ATTACK_SYNONYMS = [
    "attack", "attacks", "incident", "incidents", "event", "events", "mishap", "mishaps",
    "bombing", "bombings", "blast", "blasts", "shooting", "shootings", "massacre", "massacres",
    "tragedy", "tragedies", "occurrence", "occurrences", "disaster", "disasters", "assault",
    "assaults", "raid", "raids", "strike", "strikes", "atrocity", "atrocities", "ambush",
    "ambushes", "carnage", "slaughter", "shootout", "shootouts", "detonation", "detonations",
    "explosion", "explosions"
]
ATTACK_SYNONYMS_REGEX = "|".join(ATTACK_SYNONYMS)

GTD_KEYWORDS = [
    "terrorism", "terrorist", "attack", "attacks", "bombing", "bombings", "terror", "violence",
    "terrorism database", "gtd", "global terrorism", "terrorist group", "terrorist organization",
    "casualties", "fatalities", "terrorist attack", "terrorist attacks", "suicide attack",
    "armed attack", "assassination", "assassinations", "hostage", "hostages", "kidnapping",
    "kidnappings", "hijacking", "hijackings", "explosion", "explosions", "terrorism statistics",
    "terrorism data", "terrorism report", "terrorist incident", "terrorist activity",
    "terrorist threat", "counterterrorism", "counter-terrorism", "extremism", "radicalization",
    "incident", "incidents", "event", "events", "mishap", "mishaps", "occurrence", "occurrences",
    "happening", "happenings", "tragedy", "tragedies", "disaster", "disasters", "catastrophe",
    "blast", "blasts", "detonation", "detonations", "massacre", "massacres", "slaughter",
    "carnage", "shootout", "shooting", "shootings", "gunfire", "ambush", "raid", "raids",
    "strike", "strikes", "assault", "assaults", "atrocity", "atrocities", "act of terror",
    "acts of terror", "act of violence", "acts of violence", "suicide bombing", "car bombing",
    "truck bombing", "ied", "improvised explosive", "explosive device",
    "tell about", "details about", "information about", "show me", "what happened",
    "how many", "statistics", "data", "report", "list", "find", "search", "query"
]

COUNTRIES_REGEX = (
    r"\b(pakistan|afghanistan|iraq|syria|russia|india|indonesia|philippines|nigeria|yemen|"
    r"somalia|libya|egypt|turkey|israel|palestine|lebanon|jordan|iran|colombia|peru|mexico|"
    r"france|uk|usa|germany|spain|italy|kenya|mali|tunisia|algeria|morocco|sudan|bangladesh|"
    r"sri\s*lanka|nepal|thailand|myanmar|bali)\b"
)

# Compile production regexes
KW_PATTERNS = [re.compile(rf"\b{re.escape(k)}\b", re.IGNORECASE) for k in GTD_KEYWORDS]
STRUCTURE_RE1 = re.compile(rf"\b({ATTACK_SYNONYMS_REGEX}|terrorism|terrorist)\b", re.IGNORECASE)
STRUCTURE_RE2 = re.compile(rf"\b(how\s+many|count|total|number\s+of)\b.*\b({ATTACK_SYNONYMS_REGEX})\b", re.IGNORECASE)
STRUCTURE_RE3 = re.compile(rf"\b(in|from|by|city|country|group)\b.*{COUNTRIES_REGEX}", re.IGNORECASE)
EVENT_ID_RE = re.compile(r"\d{12}")
DATE_RE = re.compile(
    r"\b(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})\b",
    re.IGNORECASE
)
COUNTRY_RE = re.compile(COUNTRIES_REGEX, re.IGNORECASE)

def production_rule_based_classifier(query: str) -> bool:
    """Mirrors contextExtractor.isGTDQuery with strict word boundaries."""
    if not query or not isinstance(query, str):
        return False

    has_kw = any(p.search(query) for p in KW_PATTERNS)
    if has_kw:
        return True

    has_structure = (
        bool(STRUCTURE_RE1.search(query)) or
        bool(STRUCTURE_RE2.search(query)) or
        bool(STRUCTURE_RE3.search(query)) or
        bool(EVENT_ID_RE.search(query))
    )
    if has_structure:
        return True

    has_date_country = bool(DATE_RE.search(query)) and bool(COUNTRY_RE.search(query))
    return has_date_country


def load_dataset(dataset_path: Path):
    with open(dataset_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    queries = [item["query"] for item in data]
    labels = np.array([1 if item["expectedIsGTD"] else 0 for item in data])
    return queries, labels, data


def benchmark_rule_based(queries, labels, cv_splits):
    """Evaluates rule-based classifier under the exact same 5-fold partitions."""
    fold_accuracies, fold_precisions, fold_recalls, fold_f1s = [], [], [], []
    all_preds = np.zeros(len(labels), dtype=int)

    # Time per inference
    times = []
    # Warmup
    for q in queries[:20]:
        production_rule_based_classifier(q)

    # Measurement
    for _ in range(5):
        for q in queries:
            t0 = time.perf_counter()
            pred = production_rule_based_classifier(q)
            times.append(time.perf_counter() - t0)

    avg_latency_ms = (sum(times) / len(times)) * 1000.0

    for train_idx, test_idx in cv_splits:
        test_queries = [queries[i] for i in test_idx]
        test_labels = labels[test_idx]
        preds = np.array([1 if production_rule_based_classifier(q) else 0 for q in test_queries])
        all_preds[test_idx] = preds

        fold_accuracies.append(accuracy_score(test_labels, preds))
        fold_precisions.append(precision_score(test_labels, preds, zero_division=0))
        fold_recalls.append(recall_score(test_labels, preds, zero_division=0))
        fold_f1s.append(f1_score(test_labels, preds, zero_division=0))

    return {
        "method": "Rule-Based Regex Router (Production)",
        "accuracy": np.mean(fold_accuracies) * 100.0,
        "precision": np.mean(fold_precisions) * 100.0,
        "recall": np.mean(fold_recalls) * 100.0,
        "f1": np.mean(fold_f1s) * 100.0,
        "latency_ms": avg_latency_ms,
        "predictions": all_preds
    }


def benchmark_ml_pipeline(name, pipeline, queries, labels, cv_splits):
    queries_arr = np.array(queries)
    all_preds = np.zeros(len(labels), dtype=int)
    fold_accuracies, fold_precisions, fold_recalls, fold_f1s = [], [], [], []

    # Cross-validation
    for train_idx, test_idx in cv_splits:
        X_train, y_train = queries_arr[train_idx], labels[train_idx]
        X_test, y_test = queries_arr[test_idx], labels[test_idx]

        pipeline.fit(X_train, y_train)
        preds = pipeline.predict(X_test)
        all_preds[test_idx] = preds

        fold_accuracies.append(accuracy_score(y_test, preds))
        fold_precisions.append(precision_score(y_test, preds, zero_division=0))
        fold_recalls.append(recall_score(y_test, preds, zero_division=0))
        fold_f1s.append(f1_score(y_test, preds, zero_division=0))

    # Fit on entire dataset to measure single-query inference latency
    pipeline.fit(queries_arr, labels)
    times = []
    # Warmup
    for q in queries[:20]:
        pipeline.predict([q])

    for _ in range(5):
        for q in queries:
            t0 = time.perf_counter()
            pipeline.predict([q])
            times.append(time.perf_counter() - t0)

    avg_latency_ms = (sum(times) / len(times)) * 1000.0

    return {
        "method": name,
        "accuracy": np.mean(fold_accuracies) * 100.0,
        "precision": np.mean(fold_precisions) * 100.0,
        "recall": np.mean(fold_recalls) * 100.0,
        "f1": np.mean(fold_f1s) * 100.0,
        "latency_ms": avg_latency_ms,
        "predictions": all_preds
    }


def main():
    if not DATASET_PATH.exists():
        print(f"Dataset not found at {DATASET_PATH}")
        return

    queries, labels, raw_data = load_dataset(DATASET_PATH)
    print(f"Loaded {len(queries)} queries ({np.sum(labels == 1)} GTD, {np.sum(labels == 0)} Document).")

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_splits = list(skf.split(queries, labels))

    results = []

    # Method 1: Production Rule-Based Router
    print("Evaluating Method 1: Production Rule-Based Regex Router...")
    res_rule = benchmark_rule_based(queries, labels, cv_splits)
    results.append(res_rule)

    # Method 2: TF-IDF + Logistic Regression
    print("Evaluating Method 2: TF-IDF + Logistic Regression...")
    pipe_lr = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=1500, sublinear_tf=True)),
        ("clf", LogisticRegression(C=1.0, max_iter=200, random_state=42))
    ])
    res_lr = benchmark_ml_pipeline("TF-IDF + Logistic Regression", pipe_lr, queries, labels, cv_splits)
    results.append(res_lr)

    # Method 3: TF-IDF + Linear SVM
    print("Evaluating Method 3: TF-IDF + Linear SVM (LinearSVC)...")
    pipe_svm = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=1500, sublinear_tf=True)),
        ("clf", LinearSVC(C=1.0, random_state=42, dual=True, max_iter=2000))
    ])
    res_svm = benchmark_ml_pipeline("TF-IDF + Linear SVM", pipe_svm, queries, labels, cv_splits)
    results.append(res_svm)

    # Bonus Method 4: TF-IDF + Naive Bayes
    print("Evaluating Method 4: TF-IDF + Multinomial Naive Bayes...")
    pipe_nb = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=1500)),
        ("clf", MultinomialNB(alpha=0.5))
    ])
    res_nb = benchmark_ml_pipeline("TF-IDF + Multinomial Naive Bayes", pipe_nb, queries, labels, cv_splits)
    results.append(res_nb)

    # Print Table
    print("\n" + "=" * 105)
    print("EXPERIMENT 2: ROUTING CLASSIFIER COMPARISON (5-FOLD STRATIFIED CROSS-VALIDATION, N=180)")
    print("=" * 105)
    print(f"{'Method / Architecture':<38} | {'Accuracy (%)':<12} | {'Precision (%)':<13} | {'Recall (%)':<11} | {'F1-Score (%)':<12} | {'Latency (ms)':<12}")
    print("-" * 105)
    for r in results:
        print(f"{r['method']:<38} | {r['accuracy']:>10.2f}% | {r['precision']:>11.2f}% | {r['recall']:>9.2f}% | {r['f1']:>10.2f}% | {r['latency_ms']:>10.4f} ms")
    print("=" * 105)

    # Markdown Table Output
    md_table = []
    md_table.append("| Method / Classifier Architecture | Accuracy (%) | Precision (%) | Recall (%) | F1-Score (%) | Avg Latency (ms) |")
    md_table.append("| :--- | :---: | :---: | :---: | :---: | :---: |")
    for r in results:
        md_table.append(f"| **{r['method']}** | {r['accuracy']:.2f}% | {r['precision']:.2f}% | {r['recall']:.2f}% | {r['f1']:.2f}% | {r['latency_ms']:.4f} ms |")

    print("\nPublication Markdown Table:\n")
    print("\n".join(md_table))

    # Save to JSON in results/
    output_data = {
        "dataset_size": len(queries),
        "cv_folds": 5,
        "results": [
            {
                "method": r["method"],
                "accuracy": round(r["accuracy"], 2),
                "precision": round(r["precision"], 2),
                "recall": round(r["recall"], 2),
                "f1_score": round(r["f1"], 2),
                "latency_ms": round(r["latency_ms"], 4)
            }
            for r in results
        ]
    }
    out_path = REPO_ROOT / "results" / "classifier_comparison_benchmark.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)
    print(f"\nSaved benchmark comparison results to {out_path}")

if __name__ == "__main__":
    main()
