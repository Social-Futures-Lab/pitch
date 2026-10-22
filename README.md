# PITCH: Proactive Intervention Timing for CHat

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A benchmark for evaluating AI systems' ability to identify optimal timing for proactive knowledge surfacing in group conversations.

**🌐 [PITCH Project Website](https://social.cs.washington.edu/PITCH-website)**

This benchmark was developed to advance research in proactive AI systems and human-AI collaboration. Special thanks to all conversation participants and annotators who contributed to the dataset.

## Table of Contents

- [Overview](#overview)
- [Repository Structure](#repository-structure)
- [Quick Start](#quick-start)
- [Use Cases](#use-cases)
- [Documentation](#documentation)
- [Citation](#citation)
- [License](#license)
- [Contact](#contact)



## Overview

**PITCH** is a research benchmark that addresses a fundamental question in human-AI interaction: *When should an AI assistant proactively surface information during a conversation?*

While much research focuses on *what* information to provide, PITCH specifically targets *when* the information is provided, measuring whether AI systems can identify opportune moments for intervention in group discussions.

### Key Features

- Human-annotated timing judgments from real group conversations
- Multi-stage annotation workflow with deliberation and consensus building
- Reproducible evaluation framework for testing AI prediction systems
- Full-stack annotation platform for collecting additional data


## Repository Structure

```
pitch-benchmark/
├── annotation-system/              # Full-stack web platform for data collection
│   ├── backend/
│   ├── frontend/
│   └── README.md
│
├── data/                           # Benchmark dataset
│   ├── pitch-benchmark-data.json   # Full conversations and annotations
│   └── human-baseline-data.csv     # Human timing judgments
│   └── README.md
|
├── CITATION.cff
└── LICENSE
```

### Annotation System

The [`annotation-system/`](annotation-system/) directory contains the full-stack annotation platform used in PITCH benchmark's data collection.

**See [`annotation-system/README.md`](annotation-system/README.md) for implementation details and user guide.**

### Benchmark Data

The [`data/`](data/) directory contains the complete benchmark dataset with human-annotated timing judgments from real group conversations. Includes full conversation transcripts, knowledge items, and multi-annotator timing decisions with consensus building.

**See [`data/README.md`](data/README.md) for data format, schema, and usage examples.**


## Quick Start

### Annotation System (Data Collection Platform)

The annotation system enables researchers to:
- Conduct real-time group conversations
- Collect knowledge items participants wish they had during discussion
- Gather timing annotations from independent annotators
- Build consensus through deliberation

**Setup:**

```bash
cd annotation-system
cp .env.example .env
# Edit .env with your JWT_SECRET_KEY

# Start Postgres
docker compose up -d db

# Backend (Python 3.11+)
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000

# Frontend (Node.js 20+)
cd ../frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

**See [`annotation-system/README.md`](annotation-system/README.md) for detailed instructions.**



## Use Cases

### For Researchers

1. **Analyze benchmark data**: Use the published dataset in `data/` to study timing judgments and annotator agreement
2. **Collect new data**: Run your own studies with custom conversation prompts using the annotation system
3. **Build consensus**: Enable multi-annotator deliberation to establish ground truth
4. **Replicate findings**: Re-run analyses from the paper on the full dataset

### For AI Developers

1. **Benchmark proactive timing**: Evaluate your model's predictions against human judgment windows in the dataset
2. **Study annotation patterns**: Analyze human judgment data to inform model development
3. **Build custom evaluators**: Load the structured JSON/CSV data for your own evaluation pipelines

## Documentation

- **[Benchmark Data](data/README.md)** — Dataset format, schema, and usage examples
- **[Annotation System Setup](annotation-system/README.md)** — Full installation, architecture, and study workflow
- **[Developer Guide](CLAUDE.md)** — Architecture patterns, testing, and contribution guidelines

### Related Resources

- **[PITCH Human Baseline System](https://github.com/Social-Futures-Lab/pitch-human-baseline)** — Tools for evaluating AI predictions against human baseline judgments

## Citation

If you use PITCH in your research, please cite:

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

See [`CITATION.cff`](CITATION.cff) for structured metadata.



## License

MIT License — see [`LICENSE`](LICENSE) file.

Copyright (c) 2026 PITCH Benchmark Contributors


## Contact

For questions, feedback, or collaboration inquiries, please feel free to reach out to [Ruotong Wang](http://ruotongw.com/).
