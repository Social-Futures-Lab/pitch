# PITCH Benchmark Dataset

This directory contains the complete dataset collected using the PITCH annotation system for the paper "When Should AI Chime In? Benchmarking Timely Contribution of Proactive Agents in Multi-Party Chat."


## Files

### `pitch-benchmark-data.json` (~6MB)

Full benchmark dataset with structured conversation data and human annotations.

**Structure:**

Each entry represents a knowledge item that could be proactively shared during a conversation. Here's an example:

```json
{
    "knowledge_item_id": "7fdc716d-dede-4719-9e72-d2b959644b05",
    "conversation_id": "bd99528c-f40b-4669-ae67-6c520d2b6569",
    "scenario": "trip",
    "topic": "Pick a destination together (...)",
    "turns": [
      {
        "turn_number": 1,
        "speaker": "speaker 1",
        "text": "Hi!"
      },
      {...}
    ],
    "n_turns": 74,
    "start_turn": 1,
    "end_turn": 74,
    "raw_ideal_response": "For current pricing, I'd check the official Lake Chelan State Park website (...)",
    "neutralized_ideal_response": "For current pricing, I'd check the official Lake Chelan State Park website (...)",
    "contribution_type": "suggestion",
    "contribution_type_detail": "Suggest: check the official park website for current pricing",
    "individual_annotations": [
      {
        "annotator_id": "speaker_1",
        "annotator_name": "speaker 1",
        "role": "author",
        "is_author": true,
        "do_not_surface": false,
        "best_turn": 34,
        "window_start": 34,
        "window_end": 37,
        "pertinence": 0.25,
        "rationale": null,
        "phase": "construction",
        "from_deliberation": false
      },
      {...}
    ],
    "ground_truth": {
      "do_not_surface": false,
      "accepted_best_turns": [34, 35, 48],
      "acceptable_windows": [[34, 37], [33, 40], [19, 52]],
      "consensus_best_turn": 34,
      "union_window_start": 19,
      "union_window_end": 52,
      "n_distinct_annotators": 3,
      "n_place": 3,
      "n_dns": 0,
      "best_turn_spread": 14,
      "individual_pertinences": [0.25, 0.75, 0.75]
    }
  }
```

**Key Fields:**

- **`knowledge_item_id`** - Unique identifier for each piece of information
- **`conversation_id`** - Links to the specific conversation where this item could help
- **`scenario`** - Domain/type of conversation (trip planning, scholar discussions)
- **`topic`** - Full prompt that guided the conversation
- **`n_turns`** - Total number of turns in the conversation
- **`start_turn`** / **`end_turn`** - Conversation segment range
- **`turns`** - Complete conversation transcript with turn numbers, speakers, and text
- **`raw_ideal_response`** - The knowledge item text as originally provided
- **`neutralized_ideal_response`** - Knowledge item with conversation-specific references removed for generalizability
- **`contribution_type`** - High-level category of the contribution (e.g., "suggestion", "clarification")
- **`contribution_type_detail`** - Detailed description of what the contribution provides
- **`individual_annotations`** - Array of individual annotator timing judgments, each including:
  - `annotator_id` / `annotator_name` - Annotator identifier and display name
  - `role` - Annotator's relationship: "author" or "within_group" (conversation participant)
  - `is_author` - Boolean indicating if annotator wrote the knowledge item
  - `do_not_surface` - Whether annotator believes item should NOT be surfaced
  - `best_turn` - Single optimal turn for surfacing (if do_not_surface is false)
  - `window_start` / `window_end` - Acceptable timing window bounds
  - `pertinence` - Relevance rating (0.0 to 1.0)
  - `rationale` - Optional text explanation for the timing judgment
  - `phase` - Data collection stage: "construction", "cross_annotation", or "deliberation"
  - `from_deliberation` - Whether annotation was produced during deliberation
- **`ground_truth`** - Aggregated consensus from all annotations, including:
  - `do_not_surface` - Whether consensus is to NOT surface this item
  - `accepted_best_turns` - List of all annotator-selected "best turns"
  - `acceptable_windows` - List of all [start, end] timing windows from annotators
  - `consensus_best_turn` - The agreed-upon optimal turn
  - `union_window_start` / `union_window_end` - Earliest and latest acceptable turns across all annotators
  - `n_distinct_annotators` - Number of unique annotators
  - `n_place` - Number of annotators who said to surface the item
  - `n_dns` - Number of annotators who said "do not surface"
  - `best_turn_spread` - Range of best turn selections (max - min)
  - `individual_pertinences` - List of all pertinence ratings

<br/>

### `human-baseline-data.csv` (~39KB)

Simplified timing data for comparing AI predictions against human judgment windows.

**Schema:**

| Column | Type | Description |
|--------|------|-------------|
| `scenario` | string | Conversation domain (trip or scholar) |
| `conversation_id` | string | Links to full conversation in JSON file |
| `knowledge_item_id` | string | Links to specific knowledge item in JSON file |
| `participant_id` | string | Human baseline study participant identifier |
| `selection_status` | string | 'placed_at_turn' or 'marked_not_relevant' |
| `turn_selected` | int | Turn where participant placed the item (null if not placed) |
| `annotator_best_turns` | string | Semicolon-separated list of best turns identified by original annotators (e.g., "28;30;34") |
| `earliest_acceptable_turn` | int | Lower bound of annotator acceptable timing window |
| `latest_acceptable_turn` | int | Upper bound of annotator acceptable timing window |


## Usage

### Loading the Data

**Python:**
```python
import json
import pandas as pd

# Load full benchmark data (use UTF-8 encoding)
with open('data/pitch-benchmark-data.json', encoding='utf-8') as f:
    benchmark_data = json.load(f)

# Load human baseline
baseline_df = pd.read_csv('data/human-baseline-data.csv')
```

**JavaScript/TypeScript:**
```typescript
import benchmarkData from './data/pitch-benchmark-data.json';
import Papa from 'papaparse';

// Load CSV
Papa.parse('data/human-baseline-data.csv', {
  header: true,
  complete: (results) => {
    const baselineData = results.data;
  }
});
```

## Evaluation Examples

### Check if AI prediction falls in human judgment window

```python
import pandas as pd

baseline = pd.read_csv('data/human-baseline-data.csv')

def evaluate_prediction(conversation_id, knowledge_item_id, predicted_turn):
    """Check if predicted turn falls within human-annotated acceptable window."""
    row = baseline[
        (baseline['conversation_id'] == conversation_id) & 
        (baseline['knowledge_item_id'] == knowledge_item_id)
    ].iloc[0]
    
    earliest = row['earliest_acceptable_turn']
    latest = row['latest_acceptable_turn']
    
    return earliest <= predicted_turn <= latest
```

### Analyze annotator agreement

```python
import json

with open('data/pitch-benchmark-data.json', encoding='utf-8') as f:
    data = json.load(f)

for item in data:
    ground_truth = item['ground_truth']
    
    # Check spread of best turn judgments
    spread = ground_truth['best_turn_spread']
    best_turns = ground_truth['accepted_best_turns']
    
    if spread > 0:
        print(f"Item {item['knowledge_item_id']}: spread = {spread} turns")
        print(f"  Best turns selected: {best_turns}")
        print(f"  Union window: {ground_truth['union_window_start']}-{ground_truth['union_window_end']}")
```

## Data Collection Process

`pitch-benchmark-data.json`: Data was collected through a multi-stage process:

1. **Conversation Stage**: Groups of 3-4 participants engaged in real-time chat conversations on specific topics
2. **Item Construction** (`phase: "construction"`): After conversations, participants reviewed the transcript and identified moments where external information would have been helpful, then provided the knowledge item text and initial timing judgment
3. **Cross-Annotation** (`phase: "cross_annotation"`): Independent annotators (including other conversation participants) reviewed conversation + knowledge item pairs and identified optimal timing for AI intervention
4. **Deliberation** (`phase: "deliberation"`): Annotators with differing judgments discussed to build consensus, producing revised annotations marked with `from_deliberation: true`
5. **Ground Truth Aggregation**: All individual annotations are aggregated into the `ground_truth` object with consensus metrics

<br/>

`human-baseline-data.csv`: Data was collected through a Prolific study where each participant judged an item from data collected in `pitch-benchmark-data.json` in a live replay setting and selected the best turn for that message.


See the paper for detailed methodology.

## Citation

If you use this dataset in your research, please cite:

```bibtex
@article{wang2026pitch,
  title   = {When Should AI Chime In? Benchmarking Timely Contribution
             of Proactive Agents in Multi-Party Chat},
  author  = {Wang, Ruotong and Yu, Brian S. and Zhou, Xinyi and
             Chang, Joseph Chee and Siangliulue, Pao and Bragg, Jonathan and
             Jiang, Liwei and Zhang, Amy X.},
  journal = {arXiv preprint},
  year    = {2026}
}
```


## License

This dataset is released under the MIT License. See the repository root LICENSE file for details.
