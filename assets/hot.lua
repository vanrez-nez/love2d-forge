-- hot.lua — managed by Love2D Hot Reload extension, do not edit

local watched  = {}
local elapsed  = 0
local INTERVAL = 0.3

local function merge(live, fresh)
  if type(live) ~= "table" or type(fresh) ~= "table" then return end
  for k, v in pairs(fresh) do
    if type(v) == "function" then
      live[k] = v
    elseif type(v) == "table" and type(live[k]) == "table" then
      merge(live[k], v)
    end
    -- non-function values are left untouched: local state survives
  end
end

local function reload(modname, entry)
  local chunk, err = love.filesystem.load(entry.path)
  if not chunk then
    print("[hot] parse error in " .. modname .. ": " .. tostring(err))
    return
  end

  local ok, fresh = pcall(chunk)
  if not ok then
    print("[hot] runtime error in " .. modname .. ": " .. tostring(fresh))
    return
  end

  local live = package.loaded[modname]
  if type(fresh) == "table" and type(live) == "table" then
    merge(live, fresh)
    print("[hot] swapped: " .. modname)
  else
    -- module doesn't return a table: full re-require
    package.loaded[modname] = nil
    local rok, rerr = pcall(require, modname)
    if not rok then
      print("[hot] re-require error in " .. modname .. ": " .. tostring(rerr))
    else
      print("[hot] reloaded: " .. modname)
    end
  end
end

local function snapshot()
  for modname, _ in pairs(package.loaded) do
    if not watched[modname] then
      local path = package.searchpath(modname, package.path)
      if path then
        local info = love.filesystem.getInfo(path)
        if info then
          watched[modname] = { path = path, mtime = info.modtime }
        end
      end
    end
  end
end

local function check()
  for modname, entry in pairs(watched) do
    local info = love.filesystem.getInfo(entry.path)
    if info and info.modtime ~= entry.mtime then
      entry.mtime = info.modtime
      reload(modname, entry)
    end
  end
end

-- hook love.update non-destructively
local _update = love.update or function() end
love.update = function(dt)
  elapsed = elapsed + dt
  if elapsed >= INTERVAL then
    elapsed = 0
    check()
    snapshot()
  end
  _update(dt)
end

snapshot()
print("[hot] hot reload active")
