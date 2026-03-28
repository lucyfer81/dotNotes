# dotNotes Internal Note Import API

用于其他 dotFamily 应用向 dotNotes 写入笔记的内部接口。

## Endpoint

- Method: `POST`
- URL: `/api/internal/notes/imports`
- Header:
  - `Content-Type: application/json`
  - `Accept: application/json`
  - `x-dotfamily-internal-token: <NOTES_API_SHARED_TOKEN>`

## Request Body

```json
{
  "title": "一条导入笔记",
  "content": "这里是正文",
  "tags": ["clip", "todo"],
  "folder": "10-Projects/Client A"
}
```

字段说明：

- `title`: 必填，笔记标题
- `content`: 必填，笔记正文
- `bodyText`: 可选，`content` 的别名
- `tags`: 可选
  - 支持字符串数组
  - 也支持逗号分隔字符串，例如 `"clip,todo"`
- `tagNames`: 可选，字符串数组，和 `tags` 会合并去重
- `folderId`: 可选，精确目录 ID
- `folder`: 可选，目录引用，支持：
  - 目录 ID
  - 目录 slug
  - 目录 name
  - 目录路径，例如 `10-Projects/Client A`

## Folder Resolution

- 如果传 `folderId`，优先按 `folderId` 解析
- 如果传 `folder`，按以下顺序解析：
  - 目录 ID
  - 单段 slug 或 name
  - 多段路径，如 `10-Projects/Client A`
- 如果未传 `folder` / `folderId`，默认写入 `00-Inbox`
- 如果目录不存在，返回 `400`
- 如果目录名有歧义，返回 `400`，并在 `details` 中提示候选项

## Tags

- 已存在标签会复用
- 不存在的标签会自动创建
- 超过单笔记标签上限时返回 `400`

## Success Response

```json
{
  "ok": true,
  "data": {
    "noteId": "9f23...",
    "title": "一条导入笔记",
    "slug": "yi-tiao-dao-ru-bi-ji",
    "folderId": "folder-10-projects-client-a",
    "created": true,
    "tags": [
      {
        "id": "0d79...",
        "name": "clip"
      }
    ]
  }
}
```

## Error Response

```json
{
  "ok": false,
  "error": "Folder does not exist",
  "details": "10-Projects/Missing Folder"
}
```

## Example Clients

- TypeScript: [scripts/examples/dotnotes-client.ts](/home/ubuntu/NodeProjects/dotFamily/dotnotes/scripts/examples/dotnotes-client.ts)
- Python: [scripts/examples/dotnotes_client.py](/home/ubuntu/NodeProjects/dotFamily/dotnotes/scripts/examples/dotnotes_client.py)
