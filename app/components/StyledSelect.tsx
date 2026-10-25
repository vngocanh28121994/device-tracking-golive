"use client";

import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; description?: string; avatar?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
};

export function StyledSelect({ value, onChange, options, placeholder, ariaLabel, disabled }: Props) {
  const selected = options.find(option => option.value === value);
  return <Select.Root
    value={value || null}
    onValueChange={next => onChange(next ?? "")}
    items={options.map(option => ({ value: option.value, label: option.label }))}
    disabled={disabled}
  >
    <Select.Trigger className="styled-select-trigger" aria-label={ariaLabel}>
      {selected?.avatar && <img className="select-avatar" src={selected.avatar} alt=""/>}
      <span className="styled-select-value"><Select.Value placeholder={<span className="styled-select-placeholder">{placeholder}</span>} /></span>
      <Select.Icon className="styled-select-icon"><ChevronDown size={16} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner className="styled-select-positioner" sideOffset={7} alignItemWithTrigger={false}>
        <Select.Popup className="styled-select-popup">
          <Select.List className="styled-select-list">
            {options.map(option => <Select.Item className="styled-select-item" key={option.value} value={option.value} label={option.label}>
              {option.avatar && <img className="select-avatar" src={option.avatar} alt=""/>}
              <span className="styled-select-item-copy"><Select.ItemText>{option.label}</Select.ItemText>{option.description && <small>{option.description}</small>}</span>
              <Select.ItemIndicator className="styled-select-check"><Check size={16} /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
