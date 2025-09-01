#!/bin/bash
echo "=== COMPREHENSIVE DUPLICATE FILE ANALYSIS ===" > complete-duplicate-analysis.md
echo "" >> complete-duplicate-analysis.md
echo "## Files That Differ From Main Version" >> complete-duplicate-analysis.md
echo "" >> complete-duplicate-analysis.md

# Track different files for Gemini analysis
different_files=""

# Function to analyze duplicates in a directory
analyze_directory() {
    local dir="$1"
    echo "Analyzing directory: $dir" >&2
    
    # Get all base filenames (without numbers)
    for file in "$dir"/*; do
        if [[ -f "$file" && ! "$file" =~ \ [0-9] ]]; then
            basename=$(basename "$file")
            base_path="$dir/$basename"
            
            for num in 2 3 4; do
                dup_file="$dir/${basename%.*} ${num}.${basename##*.}"
                if [[ -f "$dup_file" ]]; then
                    if cmp -s "$base_path" "$dup_file" 2>/dev/null; then
                        echo "REMOVING EXACT: $dup_file" >&2
                        rm -f "$dup_file"
                    else
                        echo "### $dup_file" >> complete-duplicate-analysis.md
                        echo "**Main file:** $base_path" >> complete-duplicate-analysis.md
                        echo "**Status:** DIFFERENT - needs analysis" >> complete-duplicate-analysis.md
                        echo "" >> complete-duplicate-analysis.md
                        different_files="$different_files $dup_file"
                    fi
                fi
            done
        fi
    done
}

# Analyze key directories
analyze_directory "tests/setup"
analyze_directory "tests/utils"
analyze_directory "tests/unit/hooks"
analyze_directory "tests/unit/utils"

echo "Different files found: $different_files" >&2
echo "" >> complete-duplicate-analysis.md
echo "## Summary" >> complete-duplicate-analysis.md
echo "Files requiring analysis: $(echo $different_files | wc -w)" >> complete-duplicate-analysis.md


