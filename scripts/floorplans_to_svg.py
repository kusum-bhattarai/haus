#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def preprocess_floorplan(input_path: Path, scale: int, min_area: int) -> Image.Image:
  gray = cv2.imread(str(input_path), cv2.IMREAD_GRAYSCALE)
  if gray is None:
    raise FileNotFoundError(input_path)

  enlarged = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
  blurred = cv2.GaussianBlur(enlarged, (0, 0), 1.2)
  _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
  binary = cv2.morphologyEx(
    binary,
    cv2.MORPH_CLOSE,
    cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
    iterations=1
  )

  component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
  cleaned = np.zeros_like(binary)
  min_span = 22 * scale
  for component_index in range(1, component_count):
    x, y, width, height, area = stats[component_index]
    if area >= min_area or width >= min_span or height >= min_span:
      cleaned[labels == component_index] = 255

  return Image.fromarray(255 - cleaned).convert('1')


def convert_image_to_svg(input_path: Path, output_path: Path, scale: int, min_area: int) -> None:
  binary = preprocess_floorplan(input_path, scale=scale, min_area=min_area)
  with tempfile.NamedTemporaryFile(suffix='.pbm', delete=False) as handle:
    pbm_path = Path(handle.name)
  try:
    binary.save(pbm_path)
    subprocess.run(
      ['potrace', '-s', '-o', str(output_path), str(pbm_path)],
      check=True
    )
  finally:
    pbm_path.unlink(missing_ok=True)


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument('images', nargs='+')
  parser.add_argument('--scale', type=int, default=4)
  parser.add_argument('--min-area', type=int, default=520)
  args = parser.parse_args()

  for image_arg in args.images:
    input_path = Path(image_arg)
    output_path = input_path.with_suffix('.svg')
    convert_image_to_svg(input_path, output_path, args.scale, args.min_area)
    print(output_path)


if __name__ == '__main__':
  main()
