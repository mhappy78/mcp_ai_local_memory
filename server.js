#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { fileURLToPath } from 'url';

// ES Module에서 __dirname 사용하기 위한 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경 변수 설정
const PORT = process.env.PORT || 8000;
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');

// 저장 폴더가 없으면 생성
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// MCP 서버 생성
const server = new McpServer({
  name: "FileManager",
  version: "1.0.0"
});

// 파일 크기 포맷팅 함수
function formatFileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// 파일 목록 조회 도구
server.tool(
  "list_files",
  "List files and directories in a specified directory",
  {
    directory: z.string().optional().describe("The directory path to list files from, relative to storage directory"),
  },
  async ({ directory }) => {
    try {
      const targetPath = directory 
        ? path.join(STORAGE_DIR, directory)
        : STORAGE_DIR;
      
      // 경로가 저장 디렉토리 범위를 벗어나지 않는지 확인
      if (!targetPath.startsWith(STORAGE_DIR)) {
        return { content: [{ type: "text", text: "Access denied: The specified path is outside the storage directory." }] };
      }
      
      if (!fs.existsSync(targetPath)) {
        return { content: [{ type: "text", text: "Directory not found." }] };
      }
      
      if (!fs.statSync(targetPath).isDirectory()) {
        return { content: [{ type: "text", text: "The specified path is not a directory." }] };
      }
      
      const files = fs.readdirSync(targetPath).map(file => {
        const filePath = path.join(targetPath, file);
        const stats = fs.statSync(filePath);
        const relativePath = path.relative(STORAGE_DIR, filePath);
        
        return {
          name: file,
          path: relativePath,
          size: formatFileSize(stats.size),
          isDirectory: stats.isDirectory(),
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString()
        };
      });
      
      const resultText = files.map(file => 
        `${file.isDirectory ? '[DIR]' : '[FILE]'} ${file.name}\n  Path: ${file.path}\n  Size: ${file.size}\n  Created: ${file.created}\n  Modified: ${file.modified}\n`
      ).join("\n");
      
      return { 
        content: [
          { type: "text", text: files.length > 0 
            ? `${files.length} items found:\n\n${resultText}`
            : "No files found in the directory."
          }
        ] 
      };
    } catch (error) {
      return { content: [{ type: "text", text: `An error occurred while listing files: ${error.message}` }] };
    }
  }
);

// 파일 읽기 도구
server.tool(
  "read_file",
  "Read the contents of a text file",
  {
    filePath: z.string().describe("The path of the file to read, relative to storage directory"),
  },
  async ({ filePath }) => {
    try {
      const targetPath = path.join(STORAGE_DIR, filePath);
      
      // 경로가 저장 디렉토리 범위를 벗어나지 않는지 확인
      if (!targetPath.startsWith(STORAGE_DIR)) {
        return { content: [{ type: "text", text: "Access denied: The specified path is outside the storage directory." }] };
      }
      
      if (!fs.existsSync(targetPath)) {
        return { content: [{ type: "text", text: "File not found." }] };
      }
      
      if (fs.statSync(targetPath).isDirectory()) {
        return { content: [{ type: "text", text: "Cannot read a directory as a file." }] };
      }
      
      const mimeType = mime.lookup(targetPath) || 'application/octet-stream';
      
      // 텍스트 파일만 읽기
      if (!mimeType.startsWith('text/') && !['application/json', 'application/javascript', 'application/xml'].includes(mimeType)) {
        return { content: [{ type: "text", text: `Cannot read binary file of type: ${mimeType}` }] };
      }
      
      const content = fs.readFileSync(targetPath, 'utf8');
      return { 
        content: [
          { type: "text", text: `File: ${filePath}\nType: ${mimeType}\n\nContent:\n${content}` }
        ] 
      };
    } catch (error) {
      return { content: [{ type: "text", text: `An error occurred while reading the file: ${error.message}` }] };
    }
  }
);

// 파일 작성 도구
server.tool(
  "write_file",
  "Create or update a text file",
  {
    filePath: z.string().describe("The path of the file to write, relative to storage directory"),
    content: z.string().describe("The content to write to the file"),
  },
  async ({ filePath, content }) => {
    try {
      const targetPath = path.join(STORAGE_DIR, filePath);
      
      // 경로가 저장 디렉토리 범위를 벗어나지 않는지 확인
      if (!targetPath.startsWith(STORAGE_DIR)) {
        return { content: [{ type: "text", text: "Access denied: The specified path is outside the storage directory." }] };
      }
      
      // 디렉토리가 없으면 생성
      const dirPath = path.dirname(targetPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      const isNewFile = !fs.existsSync(targetPath);
      fs.writeFileSync(targetPath, content);
      
      return { 
        content: [
          { type: "text", text: `File ${isNewFile ? 'created' : 'updated'} successfully: ${filePath}` }
        ] 
      };
    } catch (error) {
      return { content: [{ type: "text", text: `An error occurred while writing the file: ${error.message}` }] };
    }
  }
);

// 디렉토리 생성 도구
server.tool(
  "create_directory",
  "Create a new directory",
  {
    directoryPath: z.string().describe("The path of the directory to create, relative to storage directory"),
  },
  async ({ directoryPath }) => {
    try {
      const targetPath = path.join(STORAGE_DIR, directoryPath);
      
      // 경로가 저장 디렉토리 범위를 벗어나지 않는지 확인
      if (!targetPath.startsWith(STORAGE_DIR)) {
        return { content: [{ type: "text", text: "Access denied: The specified path is outside the storage directory." }] };
      }
      
      if (fs.existsSync(targetPath)) {
        return { content: [{ type: "text", text: "Directory already exists." }] };
      }
      
      fs.mkdirSync(targetPath, { recursive: true });
      
      return { 
        content: [
          { type: "text", text: `Directory created successfully: ${directoryPath}` }
        ] 
      };
    } catch (error) {
      return { content: [{ type: "text", text: `An error occurred while creating the directory: ${error.message}` }] };
    }
  }
);

// 파일/디렉토리 삭제 도구
server.tool(
  "delete_item",
  "Delete a file or directory",
  {
    itemPath: z.string().describe("The path of the file or directory to delete, relative to storage directory"),
    recursive: z.boolean().optional().default(true).describe("Whether to recursively delete directories"),
  },
  async ({ itemPath, recursive }) => {
    try {
      const targetPath = path.join(STORAGE_DIR, itemPath);
      
      // 경로가 저장 디렉토리 범위를 벗어나지 않는지 확인
      if (!targetPath.startsWith(STORAGE_DIR)) {
        return { content: [{ type: "text", text: "Access denied: The specified path is outside the storage directory." }] };
      }
      
      if (!fs.existsSync(targetPath)) {
        return { content: [{ type: "text", text: "File or directory not found." }] };
      }
      
      const stats = fs.statSync(targetPath);
      
      if (stats.isDirectory()) {
        fs.rmSync(targetPath, { recursive });
        return { 
          content: [
            { type: "text", text: `Directory deleted successfully: ${itemPath}` }
          ] 
        };
      } else {
        fs.unlinkSync(targetPath);
        return { 
          content: [
            { type: "text", text: `File deleted successfully: ${itemPath}` }
          ] 
        };
      }
    } catch (error) {
      return { content: [{ type: "text", text: `An error occurred while deleting the item: ${error.message}` }] };
    }
  }
);

// 파일 검색 도구
server.tool(
  "search_files",
  "Search for files in the storage directory",
  {
    directory: z.string().optional().describe("The directory to search in, relative to storage directory"),
    filename: z.string().optional().describe("The filename or pattern to search for"),
    extension: z.string().optional().describe("The file extension to search for"),
    contentSearch: z.string().optional().describe("Text to search for within file contents"),
    recursive: z.boolean().optional().default(true).describe("Whether to search subdirectories recursively"),
  },
  async ({ directory, filename, extension, contentSearch, recursive }) => {
    try {
      const searchPath = directory 
        ? path.join(STORAGE_DIR, directory)
        : STORAGE_DIR;
      
      // 경로가 저장 디렉토리 범위를 벗어나지 않는지 확인
      if (!searchPath.startsWith(STORAGE_DIR)) {
        return { content: [{ type: "text", text: "Access denied: The specified path is outside the storage directory." }] };
      }
      
      if (!fs.existsSync(searchPath)) {
        return { content: [{ type: "text", text: "Search directory not found." }] };
      }
      
      if (!fs.statSync(searchPath).isDirectory()) {
        return { content: [{ type: "text", text: "The specified path is not a directory." }] };
      }
      
      const results = [];
      
      function searchDirectory(currentPath) {
        const items = fs.readdirSync(currentPath);
        
        for (const item of items) {
          const itemPath = path.join(currentPath, item);
          const stats = fs.statSync(itemPath);
          const relativePath = path.relative(STORAGE_DIR, itemPath);
          
          if (stats.isDirectory()) {
            if (recursive) {
              searchDirectory(itemPath);
            }
            continue;
          }
          
          // 파일 이름 검색
          if (filename && !item.toLowerCase().includes(filename.toLowerCase())) {
            continue;
          }
          
          // 확장자 검색
          if (extension) {
            const fileExt = path.extname(item).slice(1).toLowerCase();
            if (fileExt !== extension.toLowerCase()) {
              continue;
            }
          }
          
          // 내용 검색
          if (contentSearch) {
            try {
              const mimeType = mime.lookup(itemPath) || 'application/octet-stream';
              if (mimeType.startsWith('text/') || ['application/json', 'application/javascript', 'application/xml'].includes(mimeType)) {
                const content = fs.readFileSync(itemPath, 'utf8');
                if (!content.toLowerCase().includes(contentSearch.toLowerCase())) {
                  continue;
                }
              } else {
                continue;
              }
            } catch (error) {
              continue;
            }
          }
          
          results.push({
            name: item,
            path: relativePath,
            size: formatFileSize(stats.size),
            modified: stats.mtime.toISOString()
          });
        }
      }
      
      searchDirectory(searchPath);
      
      const resultText = results.map(file => 
        `[FILE] ${file.name}\n  Path: ${file.path}\n  Size: ${file.size}\n  Modified: ${file.modified}\n`
      ).join("\n");
      
      return { 
        content: [
          { type: "text", text: results.length > 0 
            ? `${results.length} files found:\n\n${resultText}`
            : "No matching files found."
          }
        ] 
      };
    } catch (error) {
      return { content: [{ type: "text", text: `An error occurred while searching files: ${error.message}` }] };
    }
  }
);

// 서버 시작
const transport = new StdioServerTransport();
server.listen(transport);