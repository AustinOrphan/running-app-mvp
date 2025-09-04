#!/usr/bin/env python3
"""
Duplicate File Scanner with MCP Integration
Systematically finds and categorizes duplicate files using Serena MCP tools.
"""

import os
import sys
import json
import glob
import hashlib
import subprocess
from pathlib import Path
from typing import List, Dict, Tuple

class MCPDuplicateScanner:
    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root)
        self.duplicates = []
        self.exact_duplicates = []
        self.different_files = []
        self.orphan_files = []
        
    def scan_for_patterns(self) -> Dict[str, List[str]]:
        """Find all files matching duplicate patterns"""
        patterns = ['* 2.*', '* 3.*', '* 4.*', '* 5.*', '* 6.*', '* 7.*', '* 8.*', '* 9.*']
        results = {}
        
        os.chdir(self.project_root)
        
        for pattern in patterns:
            files = glob.glob(pattern)
            if files:
                results[pattern] = files
                self.duplicates.extend(files)
        
        return results
    
    def get_file_hash(self, filename: str) -> str:
        """Get MD5 hash of file content"""
        try:
            with open(filename, 'rb') as f:
                return hashlib.md5(f.read()).hexdigest()
        except Exception:
            return None
    
    def categorize_duplicates(self) -> Dict[str, List[str]]:
        """Categorize duplicates as exact, different, or orphaned"""
        for dup_file in self.duplicates:
            base_file = self.get_base_filename(dup_file)
            
            if os.path.exists(base_file):
                dup_hash = self.get_file_hash(dup_file)
                base_hash = self.get_file_hash(base_file)
                
                if dup_hash and base_hash and dup_hash == base_hash:
                    self.exact_duplicates.append(dup_file)
                else:
                    self.different_files.append(dup_file)
            else:
                self.orphan_files.append(dup_file)
        
        return {
            'exact_duplicates': self.exact_duplicates,
            'different_files': self.different_files, 
            'orphan_files': self.orphan_files
        }
    
    def get_base_filename(self, duplicate_file: str) -> str:
        """Convert numbered duplicate filename to base filename"""
        for num in [' 2.', ' 3.', ' 4.', ' 5.', ' 6.', ' 7.', ' 8.', ' 9.']:
            if num in duplicate_file:
                return duplicate_file.replace(num, '.')
        return duplicate_file
    
    def call_mcp_serena_memory(self, memory_name: str, content: str):
        """Store results in Serena memory (would be actual MCP call)"""
        print(f"📝 Would store in Serena memory '{memory_name}': {content[:100]}...")
        # In actual implementation, would call:
        # mcp__serena__write_memory(memory_name=memory_name, content=content)
    
    def generate_report(self) -> Dict:
        """Generate comprehensive duplicate analysis report"""
        patterns = self.scan_for_patterns()
        categorization = self.categorize_duplicates()
        
        report = {
            'scan_timestamp': str(os.path.getctime('.')),
            'total_duplicates': len(self.duplicates),
            'patterns_found': patterns,
            'categorization': categorization,
            'summary': {
                'exact_duplicates': len(self.exact_duplicates),
                'different_files': len(self.different_files),
                'orphan_files': len(self.orphan_files)
            },
            'recommendations': self.generate_recommendations()
        }
        
        # Store in Serena memory
        self.call_mcp_serena_memory(
            "duplicate_scan_results", 
            json.dumps(report, indent=2)
        )
        
        return report
    
    def generate_recommendations(self) -> Dict[str, List[str]]:
        """Generate cleanup recommendations based on analysis"""
        return {
            'safe_to_delete': self.exact_duplicates,
            'needs_analysis': self.different_files,
            'needs_rename': self.orphan_files
        }
    
    def export_results(self, output_file: str = "duplicate_analysis_results.json"):
        """Export results to JSON file"""
        report = self.generate_report()
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"✅ Results exported to {output_file}")
        return report

def main():
    """Main execution function"""
    print("🔍 MCP Duplicate File Scanner")
    print("=" * 40)
    
    scanner = MCPDuplicateScanner()
    report = scanner.export_results()
    
    print(f"\n📊 Scan Results:")
    print(f"   Total duplicates found: {report['total_duplicates']}")
    print(f"   Exact duplicates: {report['summary']['exact_duplicates']}")
    print(f"   Different files: {report['summary']['different_files']}")
    print(f"   Orphan files: {report['summary']['orphan_files']}")
    
    print(f"\n🎯 Recommendations:")
    print(f"   Safe to delete: {len(report['recommendations']['safe_to_delete'])} files")
    print(f"   Need analysis: {len(report['recommendations']['needs_analysis'])} files")
    print(f"   Need rename: {len(report['recommendations']['needs_rename'])} files")
    
    if len(sys.argv) > 1 and sys.argv[1] == '--show-files':
        print(f"\n📄 Exact duplicates (safe to delete):")
        for file in report['recommendations']['safe_to_delete'][:10]:
            print(f"   - {file}")
        if len(report['recommendations']['safe_to_delete']) > 10:
            print(f"   ... and {len(report['recommendations']['safe_to_delete']) - 10} more")

if __name__ == "__main__":
    main()