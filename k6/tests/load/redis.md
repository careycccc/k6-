# 连接到 Redis
redis-cli

# 查看 key 是否存在
EXISTS token_pool:3004

# 查看列表长度（有多少个 token）
LLEN token_pool:3004

# 查看所有 token（不弹出）
LRANGE token_pool:3004 0 -1

# 查看前 10 个
LRANGE token_pool:3004 0 9

# 查看某个具体的（索引从 0 开始）
LINDEX token_pool:3004 0
