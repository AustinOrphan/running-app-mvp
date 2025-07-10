# Input Component System Documentation

The Input component system provides a comprehensive set of form controls with consistent styling, validation states, and accessibility features. This system includes Input, TextArea, Select, and InputGroup components.

## Table of Contents

- [Input Component](#input-component)
- [TextArea Component](#textarea-component)
- [Select Component](#select-component)
- [InputGroup Component](#inputgroup-component)
- [Validation States](#validation-states)
- [Accessibility Features](#accessibility-features)
- [Advanced Features](#advanced-features)
- [Migration Guide](#migration-guide)

## Input Component

The Input component is a versatile form control that supports various input types with built-in validation and accessibility features.

### Basic Usage

```tsx
import { Input } from '@/components/UI';

function MyForm() {
  const [email, setEmail] = useState('');
  
  return (
    <Input
      type="email"
      label="Email Address"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="Enter your email"
      required
    />
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'text' \| 'email' \| 'password' \| 'number' \| 'date' \| 'time' \| 'tel' \| 'url' \| 'search' \| 'color'` | `'text'` | Input type |
| `label` | `string` | - | Label text for the input |
| `helperText` | `string` | - | Helper text displayed below the input |
| `error` | `boolean` | `false` | Whether the input has an error |
| `errorMessage` | `string` | - | Error message to display |
| `success` | `boolean` | `false` | Whether the input has a success state |
| `successMessage` | `string` | - | Success message to display |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | Size variant |
| `fullWidth` | `boolean` | `true` | Whether the input should take full width |
| `leadingIcon` | `ReactNode` | - | Icon to display at the start |
| `trailingIcon` | `ReactNode` | - | Icon to display at the end |
| `onTrailingIconClick` | `() => void` | - | Click handler for trailing icon |
| `showCharCount` | `boolean` | `false` | Whether to show character count |

### Input Types

#### Text Input
```tsx
<Input
  type="text"
  label="Full Name"
  value={name}
  onChange={(e) => setName(e.target.value)}
/>
```

#### Email Input
```tsx
<Input
  type="email"
  label="Email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={!!errors.email}
  errorMessage={errors.email}
/>
```

#### Password Input with Auto-Toggle
```tsx
<Input
  type="password"
  label="Password"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  helperText="Password must be at least 8 characters"
/>
```
*Note: Password inputs automatically include a show/hide toggle button.*

#### Search Input with Auto-Clear
```tsx
<Input
  type="search"
  label="Search"
  value={searchTerm}
  onChange={(e) => setSearchTerm(e.target.value)}
  placeholder="Search runs..."
/>
```
*Note: Search inputs automatically include a clear button when there's content.*

#### Number Input
```tsx
<Input
  type="number"
  label="Distance (km)"
  step="0.1"
  value={distance}
  onChange={(e) => setDistance(e.target.value)}
/>
```

#### Date Input
```tsx
<Input
  type="date"
  label="Start Date"
  value={startDate}
  onChange={(e) => setStartDate(e.target.value)}
/>
```

#### Color Input
```tsx
<Input
  type="color"
  label="Theme Color"
  value={color}
  onChange={(e) => setColor(e.target.value)}
/>
```

### Size Variants

```tsx
<Input size="small" label="Small Input" />
<Input size="medium" label="Medium Input" />
<Input size="large" label="Large Input" />
```

### With Icons

```tsx
<Input
  label="Search"
  leadingIcon={<SearchIcon />}
  trailingIcon={<ClearIcon />}
  onTrailingIconClick={() => setValue('')}
/>
```

### Character Count

```tsx
<Input
  label="Bio"
  maxLength={160}
  showCharCount
  value={bio}
  onChange={(e) => setBio(e.target.value)}
/>
```

## TextArea Component

The TextArea component provides multi-line text input with auto-resize functionality.

### Basic Usage

```tsx
import { TextArea } from '@/components/UI';

<TextArea
  label="Notes"
  value={notes}
  onChange={(e) => setNotes(e.target.value)}
  placeholder="Enter your notes..."
  rows={4}
/>
```

### Auto-Resize Feature

```tsx
<TextArea
  label="Description"
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  autoResize
  maxAutoHeight={300}
  placeholder="Enter a description..."
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `autoResize` | `boolean` | `false` | Auto-resize to fit content |
| `maxAutoHeight` | `number` | `400` | Maximum height for auto-resize (px) |
| `resize` | `'none' \| 'vertical' \| 'horizontal' \| 'both'` | `'vertical'` | Resize behavior |

*All other props from Input component are also supported.*

## Select Component

The Select component provides dropdown selection with options array support.

### Basic Usage

```tsx
import { Select } from '@/components/UI';

<Select
  label="Goal Type"
  value={selectedType}
  onChange={(e) => setSelectedType(e.target.value)}
  options={[
    { value: 'distance', label: 'Distance Goal' },
    { value: 'time', label: 'Time Goal' },
    { value: 'frequency', label: 'Frequency Goal' }
  ]}
/>
```

### With Placeholder

```tsx
<Select
  label="Category"
  value={category}
  onChange={(e) => setCategory(e.target.value)}
  placeholder="Select a category"
  options={categoryOptions}
/>
```

### Custom Option Rendering

```tsx
<Select label="Priority" value={priority} onChange={handleChange}>
  <option value="">Select priority</option>
  <option value="low">🟢 Low</option>
  <option value="medium">🟡 Medium</option>
  <option value="high">🔴 High</option>
</Select>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `Array<{value: string, label: string, disabled?: boolean}>` | `[]` | Options for the select |
| `placeholder` | `string` | - | Placeholder option |

*All other props from Input component (except input-specific ones) are also supported.*

## InputGroup Component

The InputGroup component organizes related inputs with optional labels and layouts.

### Basic Usage

```tsx
import { InputGroup } from '@/components/UI';

<InputGroup label="Personal Information">
  <Input label="First Name" />
  <Input label="Last Name" />
</InputGroup>
```

### Horizontal Layout

```tsx
<InputGroup horizontal label="Date Range">
  <Input type="date" label="Start Date" />
  <Input type="date" label="End Date" />
</InputGroup>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label for the group |
| `helperText` | `string` | - | Helper text for the group |
| `horizontal` | `boolean` | `false` | Whether fields are arranged horizontally |

## Validation States

All input components support consistent validation states:

### Error State

```tsx
<Input
  label="Email"
  value={email}
  error={!!errors.email}
  errorMessage={errors.email}
/>
```

### Success State

```tsx
<Input
  label="Username"
  value={username}
  success={usernameAvailable}
  successMessage="Username is available"
/>
```

### Helper Text

```tsx
<Input
  label="Password"
  type="password"
  helperText="Must be at least 8 characters with numbers and symbols"
/>
```

## Accessibility Features

All components include comprehensive accessibility support:

### ARIA Attributes
- `aria-invalid` for error states
- `aria-describedby` for error messages and helper text
- `aria-required` for required fields
- `aria-label` for icon buttons

### Label Association
- Automatic ID generation using `useId()`
- Proper label-input relationships
- Support for screen readers

### Keyboard Navigation
- Tab order follows visual layout
- Enter/Space activation for buttons
- Escape to clear search inputs

### Focus Management
- Visible focus indicators
- Logical focus flow
- Focus trap in modals

## Advanced Features

### Password Visibility Toggle

Password inputs automatically include a show/hide toggle:

```tsx
<Input type="password" label="Password" />
// Automatically includes eye icon for toggling visibility
```

### Search Clear Button

Search inputs automatically include a clear button when there's content:

```tsx
<Input type="search" label="Search" />
// Automatically includes × button when value exists
```

### Auto-Resize TextArea

TextArea components can automatically adjust height based on content:

```tsx
<TextArea
  autoResize
  maxAutoHeight={200}
  label="Notes"
/>
```

### Form Integration

Components work seamlessly with form libraries:

```tsx
// React Hook Form
<Input
  {...register('email', { required: 'Email is required' })}
  label="Email"
  error={!!errors.email}
  errorMessage={errors.email?.message}
/>

// Formik
<Input
  label="Email"
  value={values.email}
  onChange={handleChange}
  onBlur={handleBlur}
  error={touched.email && !!errors.email}
  errorMessage={touched.email && errors.email}
/>
```

## Migration Guide

### From Raw HTML Inputs

**Before:**
```tsx
<div className="form-group">
  <label htmlFor="email">Email</label>
  <input
    id="email"
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    className={errors.email ? 'error' : ''}
  />
  {errors.email && <span className="error-message">{errors.email}</span>}
</div>
```

**After:**
```tsx
<Input
  type="email"
  label="Email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={!!errors.email}
  errorMessage={errors.email}
/>
```

### From Material-UI or Ant Design

The Input system provides similar APIs with consistent patterns:

```tsx
// Similar to Material-UI TextField
<Input
  label="Email"
  helperText="Enter your email address"
  error={hasError}
  fullWidth
/>

// Similar to Ant Design Input
<Input
  placeholder="Enter text"
  prefix={<SearchIcon />}
  suffix={<ClearIcon />}
/>
```

## Best Practices

### Form Organization
```tsx
<form>
  <InputGroup label="Personal Information">
    <Input label="First Name" required />
    <Input label="Last Name" required />
  </InputGroup>
  
  <InputGroup horizontal label="Contact">
    <Input type="email" label="Email" required />
    <Input type="tel" label="Phone" />
  </InputGroup>
  
  <TextArea
    label="Additional Notes"
    autoResize
    maxAutoHeight={150}
  />
</form>
```

### Error Handling
```tsx
const [errors, setErrors] = useState({});

const validateForm = () => {
  const newErrors = {};
  if (!email) newErrors.email = 'Email is required';
  if (!password) newErrors.password = 'Password is required';
  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
};

return (
  <Input
    type="email"
    label="Email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    error={!!errors.email}
    errorMessage={errors.email}
    required
  />
);
```

### Performance Optimization
```tsx
// Use useCallback for event handlers
const handleChange = useCallback((e) => {
  setFormData(prev => ({ ...prev, [field]: e.target.value }));
}, [field]);

// Debounce for search inputs
const debouncedSearch = useMemo(
  () => debounce((term) => onSearch(term), 300),
  [onSearch]
);
```

## Browser Support

- **Modern Browsers**: Full feature support including auto-resize, password toggle, search clear
- **Legacy Browsers**: Graceful degradation with core functionality maintained
- **Mobile**: Touch-friendly interactions and responsive design
- **Accessibility**: Screen reader support and keyboard navigation

## CSS Custom Properties

The Input system uses CSS custom properties for consistent theming:

```css
:root {
  --color-primary: #3b82f6;
  --color-danger: #ef4444;
  --color-success: #10b981;
  --text-primary: rgba(255, 255, 255, 0.87);
  --text-secondary: rgba(255, 255, 255, 0.6);
  --surface-color: #2a2a2a;
  --border-color: #404040;
}
```

## Examples

### Complete Form Example

```tsx
import { Input, TextArea, Select, InputGroup, Button } from '@/components/UI';

function GoalForm() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: '',
    targetValue: '',
    startDate: '',
    endDate: ''
  });
  
  const [errors, setErrors] = useState({});
  
  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <Input
        label="Goal Title"
        value={formData.title}
        onChange={(e) => updateField('title', e.target.value)}
        error={!!errors.title}
        errorMessage={errors.title}
        required
      />
      
      <TextArea
        label="Description"
        value={formData.description}
        onChange={(e) => updateField('description', e.target.value)}
        autoResize
        maxAutoHeight={120}
        placeholder="Optional description..."
      />
      
      <Select
        label="Goal Type"
        value={formData.type}
        onChange={(e) => updateField('type', e.target.value)}
        options={[
          { value: 'distance', label: 'Distance Goal' },
          { value: 'time', label: 'Time Goal' },
          { value: 'frequency', label: 'Frequency Goal' }
        ]}
        error={!!errors.type}
        errorMessage={errors.type}
        required
      />
      
      <InputGroup horizontal label="Date Range">
        <Input
          type="date"
          label="Start Date"
          value={formData.startDate}
          onChange={(e) => updateField('startDate', e.target.value)}
          required
        />
        <Input
          type="date"
          label="End Date"
          value={formData.endDate}
          onChange={(e) => updateField('endDate', e.target.value)}
          required
        />
      </InputGroup>
      
      <Button type="submit" variant="primary">
        Create Goal
      </Button>
    </form>
  );
}
```

This comprehensive Input system provides a solid foundation for all form interactions in the application while maintaining consistency, accessibility, and ease of use.